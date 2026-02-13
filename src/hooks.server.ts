import type { Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { createAuthHandle } from '@vesta-cx/utils/auth';
import { paraglideMiddleware } from '$lib/paraglide/server';

const handleAuth = createAuthHandle({
	protectedPaths: ['/admin'],
	postLoginRedirect: '/admin'
});

const handleParaglide: Handle = ({ event, resolve }) =>
	paraglideMiddleware(event.request, ({ request, locale }) => {
		event.request = request;

		return resolve(event, {
			transformPageChunk: ({ html }) => html.replace('%paraglide.lang%', locale)
		});
	});

export const handle = sequence(handleAuth, handleParaglide);
