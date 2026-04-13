import { type ReactNode } from 'react';

import Link from 'next/link';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@trakrai/design-system/components/card';

import { ForgotPasswordForm, LoginForm, RegisterForm, ResetPasswordForm } from './components';

const AuthComponents: {
  [key: string]: {
    Component: () => ReactNode;
    title: string;
    description: string;
  };
} = {
  login: {
    Component: LoginForm,
    title: 'Welcome back',
    description: 'Enter your email below to login to your account',
  },
  register: {
    Component: RegisterForm,
    title: 'Register',
    description: 'Create an account with your email below',
  },
  'forgot-password': {
    Component: ForgotPasswordForm,
    title: 'Forgot password',
    description: 'Enter your email below to reset your password',
  },
  'reset-password': {
    Component: ResetPasswordForm,
    title: 'Reset password',
    description: 'Enter your new password below',
  },
};

export default async function Page(props: Readonly<PageProps<'/auth/[...path]'>>) {
  const { path } = await props.params;
  if (path.length === 0) {
    return null;
  }
  const AuthComponent = AuthComponents[path[0] ?? ''];
  if (AuthComponent === undefined) {
    return null;
  }
  return (
    <div className="bg-muted flex min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <Link className="flex items-center gap-2 self-center text-lg font-semibold" href="/">
          TrakrAI
        </Link>
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-xl">{AuthComponent.title}</CardTitle>
            <CardDescription>{AuthComponent.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <AuthComponent.Component />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
