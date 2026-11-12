// Gives the Worker a clean pages.dev address. The app, keys and rate limit all stay on the Worker.
const WORKER = 'https://roomshift-studio.cbse-homework-worker.workers.dev';
export default {
  fetch(request) {
    const url = new URL(request.url), target = new URL(url.pathname + url.search, WORKER), headers = new Headers(request.headers);
    if (headers.has('origin')) headers.set('origin', target.origin);
    return fetch(target, { method: request.method, headers, body: request.body, redirect: 'manual' });
  },
};
