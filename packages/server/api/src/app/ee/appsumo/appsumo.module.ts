import { FastifyInstance, FastifyRequest } from 'fastify'
import { Static, Type } from '@sinclair/typebox'
import { userService } from '../../user/user-service'
import { projectService } from '../../project/project-service'
import { StatusCodes } from 'http-status-codes'
import { isNil } from 'lodash'
import { appsumoService } from './appsumo.service'
import { SystemProp, system } from 'server-shared'
import { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { plansService } from '../billing/project-plan/project-plan.service'
import { defaultPlanInformation } from '../billing/project-plan/pricing-plans'
import { ALL_PRINICPAL_TYPES } from '@activepieces/shared'

export const appSumoModule: FastifyPluginAsyncTypebox = async (app) => {
    await app.register(appsumoController, { prefix: '/v1/appsumo' })
}

const exchangeCredentialUsername = system.get(SystemProp.APPSUMO_TOKEN)
const exchangeCredentialPassword = system.get(SystemProp.APPSUMO_TOKEN)
const token = system.get(SystemProp.APPSUMO_TOKEN)

const ActionRequest = Type.Object({
    action: Type.String(),
    plan_id: Type.String(),
    uuid: Type.String(),
    activation_email: Type.String(),
})

type ActionRequest = Static<typeof ActionRequest>

const ExchangeTokenRequest = Type.Object({
    username: Type.String(),
    password: Type.String(),
})
type ExchangeTokenRequest = Static<typeof ExchangeTokenRequest>

const AuthorizationHeaders = Type.Object({
    authorization: Type.String(),
})
type AuthorizationHeaders = Static<typeof AuthorizationHeaders>

const appsumoController: FastifyPluginAsyncTypebox = async (
    fastify: FastifyInstance,
) => {
    fastify.post(
        '/token',
        {
            config: {
                allowedPrincipals: ALL_PRINICPAL_TYPES,
            },
            schema: {
                body: ExchangeTokenRequest,
            },
        },
        async (
            request: FastifyRequest<{
                Body: ExchangeTokenRequest
            }>,
            reply,
        ) => {
            if (
                request.body.username === exchangeCredentialUsername &&
        request.body.password === exchangeCredentialPassword
            ) {
                return reply.status(StatusCodes.OK).send({
                    access: token,
                })
            }
            else {
                return reply.status(StatusCodes.UNAUTHORIZED).send()
            }
        },
    )

    fastify.post(
        '/action',
        {
            config: {
                allowedPrincipals: ALL_PRINICPAL_TYPES,
            },
            schema: {
                headers: AuthorizationHeaders,
                body: ActionRequest,
            },
        },
        async (
            request: FastifyRequest<{
                Headers: AuthorizationHeaders
                Body: ActionRequest
            }>,
            reply,
        ) => {
            if (request.headers.authorization != `Bearer ${token}`) {
                return reply.status(StatusCodes.UNAUTHORIZED).send()
            }
            else {
                const { plan_id, action, uuid } = request.body
                const appSumoLicense = await appsumoService.getById(uuid)
                const activation_email =
          appSumoLicense?.activation_email ?? request.body.activation_email
                const appSumoPlan = appsumoService.getPlanInformation(plan_id)
                const user = await userService.getByPlatformAndEmail({
                    platformId: system.getOrThrow(SystemProp.CLOUD_PLATFORM_ID),
                    email: activation_email,
                })
                if (!isNil(user)) {
                    const project = await projectService.getUserProjectOrThrow(user.id)
                    if (action === 'refund') {
                        await plansService.update({
                            projectId: project.id,
                            subscription: null,
                            planLimits: defaultPlanInformation,
                        })
                    }
                    else {
                        await plansService.update({
                            projectId: project.id,
                            subscription: null,
                            planLimits: appSumoPlan,
                        })
                    }
                }

                if (action === 'refund') {
                    await appsumoService.delete({
                        email: activation_email,
                    })
                }
                else {
                    await appsumoService.upsert({
                        uuid,
                        plan_id,
                        activation_email,
                    })
                }

                switch (action) {
                    case 'activate':
                        return reply.status(StatusCodes.CREATED).send({
                            redirect_url:
                'https://cloud.activepieces.com/sign-up?email=' +
                encodeURIComponent(activation_email),
                            message: 'success',
                        })
                    default:
                        return reply.status(StatusCodes.OK).send({
                            message: 'success',
                        })
                }
            }
        },
    )
}
