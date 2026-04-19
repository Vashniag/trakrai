'use client';

const ADMIN_API_PREFIX = '/api/auth/admin';

const readErrorMessage = async (response: Response): Promise<string> => {
  try {
    const payload = (await response.json()) as
      | { error?: { message?: string } | string; message?: string }
      | undefined;

    if (typeof payload?.message === 'string' && payload.message.trim() !== '') {
      return payload.message;
    }

    if (typeof payload?.error === 'string' && payload.error.trim() !== '') {
      return payload.error;
    }

    if (
      typeof payload?.error === 'object' &&
      typeof payload.error.message === 'string' &&
      payload.error.message.trim() !== ''
    ) {
      return payload.error.message;
    }
  } catch {
    // Ignore JSON parse errors and fall back to HTTP status text.
  }

  return response.statusText.trim() !== '' ? response.statusText : 'Request failed.';
};

const buildAdminUrl = (path: string): string =>
  `${ADMIN_API_PREFIX}/${path.replace(/^\/+/, '').trim()}`;

const postAdminJson = async <TResponse>(
  path: string,
  body: Record<string, unknown>,
): Promise<TResponse> => {
  const response = await fetch(buildAdminUrl(path), {
    body: JSON.stringify(body),
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return (await response.json()) as TResponse;
};

export const betterAuthAdminApi = {
  banUser: (input: { banExpiresIn?: number; banReason?: string; userId: string }) =>
    postAdminJson<{ user: unknown }>('ban-user', input),
  createUser: (input: {
    data?: Record<string, unknown>;
    email: string;
    name: string;
    password?: string;
    role?: string;
  }) => postAdminJson<{ user: unknown }>('create-user', input),
  removeUser: (input: { userId: string }) =>
    postAdminJson<{ success: boolean }>('remove-user', input),
  setRole: (input: { role: string; userId: string }) =>
    postAdminJson<{ user: unknown }>('set-role', input),
  setUserPassword: (input: { newPassword: string; userId: string }) =>
    postAdminJson<{ status: boolean }>('set-user-password', input),
  unbanUser: (input: { userId: string }) => postAdminJson<{ user: unknown }>('unban-user', input),
};
