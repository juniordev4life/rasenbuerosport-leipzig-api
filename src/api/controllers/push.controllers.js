import { handleErrorResponse } from "../helpers/error.helpers.js";
import { setGeneralResponse } from "../helpers/response.helpers.js";
import {
	preferencesBodySchema,
	subscribeBodySchema,
	subscriptionIdParamsSchema,
} from "../schemas/push.schemas.js";
import {
	createSubscription,
	deleteOwnSubscription,
	listUserSubscriptions,
	updatePreferences,
} from "../services/pushSubscriptions.services.js";

export const subscribeController = {
	schema: { body: subscribeBodySchema },
	handler: async (request, reply) => {
		try {
			const sub = await createSubscription({
				userId: request.user.id,
				endpoint: request.body.endpoint,
				p256dh: request.body.keys.p256dh,
				auth: request.body.keys.auth,
				userAgent:
					request.body.userAgent ?? request.headers["user-agent"] ?? null,
			});
			return setGeneralResponse(reply, 201, "Created", "Subscription saved", {
				id: sub.id,
			});
		} catch (error) {
			return handleErrorResponse(reply, error, request);
		}
	},
};

export const listSubscriptionsController = {
	handler: async (request, reply) => {
		try {
			const rows = await listUserSubscriptions(request.user.id);
			const data = rows.map((r) => ({
				id: r.id,
				userAgent: r.user_agent,
				preferences: r.preferences,
				createdAt: r.created_at,
				lastUsedAt: r.last_used_at,
			}));
			return setGeneralResponse(
				reply,
				200,
				"Success",
				"Subscriptions retrieved",
				data,
			);
		} catch (error) {
			return handleErrorResponse(reply, error, request);
		}
	},
};

export const deleteSubscriptionController = {
	schema: { params: subscriptionIdParamsSchema },
	handler: async (request, reply) => {
		try {
			const removed = await deleteOwnSubscription({
				id: request.params.id,
				userId: request.user.id,
			});
			if (!removed) {
				const error = new Error("Subscription not found");
				error.statusCode = 404;
				throw error;
			}
			return setGeneralResponse(
				reply,
				200,
				"Success",
				"Subscription removed",
				null,
			);
		} catch (error) {
			return handleErrorResponse(reply, error, request);
		}
	},
};

export const updatePreferencesController = {
	schema: {
		params: subscriptionIdParamsSchema,
		body: preferencesBodySchema,
	},
	handler: async (request, reply) => {
		try {
			const sub = await updatePreferences({
				id: request.params.id,
				userId: request.user.id,
				preferences: request.body.preferences,
			});
			if (!sub) {
				const error = new Error("Subscription not found");
				error.statusCode = 404;
				throw error;
			}
			return setGeneralResponse(reply, 200, "Success", "Preferences updated", {
				id: sub.id,
				preferences: sub.preferences,
			});
		} catch (error) {
			return handleErrorResponse(reply, error, request);
		}
	},
};
