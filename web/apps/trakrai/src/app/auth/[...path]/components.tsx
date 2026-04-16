'use client';

import { type FormEvent, type HTMLInputTypeAttribute, useCallback, useEffect, useState } from 'react';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Button } from '@trakrai/design-system/components/button';
import { Checkbox } from '@trakrai/design-system/components/checkbox';
import { Input } from '@trakrai/design-system/components/input';
import { Label } from '@trakrai/design-system/components/label';
import { Separator } from '@trakrai/design-system/components/separator';
import { Fingerprint, KeyRound, Mail, User2 } from 'lucide-react';
import { parseAsString, useQueryStates } from 'nuqs';
import { toast } from 'sonner';

import { authClient, signIn, signUp } from '@/lib/auth-client';

import type { Route } from 'next';

const fieldClassName =
  'h-12 rounded-none border-border/70 bg-background/80 px-4 text-sm shadow-none placeholder:text-muted-foreground/70 focus-visible:ring-1 focus-visible:ring-amber-400/50';

const primaryButtonClassName =
  'h-12 rounded-none border border-amber-400 bg-amber-400 px-4 text-sm font-semibold uppercase tracking-[0.22em] text-stone-950 transition-colors hover:bg-amber-300';

const secondaryButtonClassName =
  'h-12 rounded-none border border-border/70 bg-background/70 px-4 text-sm font-medium uppercase tracking-[0.18em] transition-colors hover:border-amber-400/50 hover:bg-muted/55';

const LinkHint = ({
  href,
  label,
  prefix,
}: Readonly<{
  href: string;
  label: string;
  prefix: string;
}>) => (
  <p className="text-center text-sm text-muted-foreground">
    {prefix}{' '}
    <Link className="font-medium text-foreground underline underline-offset-4" href={href}>
      {label}
    </Link>
  </p>
);

const FormField = ({
  autoComplete,
  icon: Icon,
  id,
  onChange,
  placeholder,
  required = true,
  type = 'text',
  value,
  label,
}: Readonly<{
  autoComplete?: string;
  icon: typeof Mail;
  id: string;
  label: string;
  onChange: (value: string) => void;
  placeholder: string;
  required?: boolean;
  type?: HTMLInputTypeAttribute;
  value: string;
}>) => (
  <div className="space-y-2">
    <Label
      className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground"
      htmlFor={id}
    >
      {label}
    </Label>
    <div className="relative">
      <Icon className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/75" />
      <Input
        autoComplete={autoComplete}
        className={`${fieldClassName} pl-11`}
        id={id}
        placeholder={placeholder}
        required={required}
        type={type}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    </div>
  </div>
);

export const LoginForm = () => {
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [passkeyAvailable, setPasskeyAvailable] = useState(false);
  const [searchParams] = useQueryStates({
    redirect: parseAsString.withDefault('/'),
  });
  const router = useRouter();

  const signInUsingPasskey = useCallback(
    async (opts?: { autoFill?: boolean }) => {
      await authClient.signIn.passkey(opts, {
        onSuccess: () => {
          router.push(searchParams.redirect as Route);
        },
        onError: (ctx) => {
          toast.error(ctx.error.message);
        },
      });
    },
    [router, searchParams.redirect],
  );

  useEffect(() => {
    const check = async () => {
      if (typeof window === 'undefined' || 'PublicKeyCredential' in window === false) {
        return;
      }

      const conditionalMediaAvailable =
        await PublicKeyCredential.isConditionalMediationAvailable();

      if (conditionalMediaAvailable) {
        setPasskeyAvailable(true);
        void signInUsingPasskey({ autoFill: true });
      }
    };

    void check();
  }, [signInUsingPasskey]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    await signIn.email(
      {
        email,
        password,
        rememberMe: remember,
        callbackURL: searchParams.redirect,
      },
      {
        onResponse: () => {
          setLoading(false);
        },
        onError: (ctx) => {
          toast.error(ctx.error.message);
        },
      },
    );
  };

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <div className="space-y-4">
        <FormField
          autoComplete="email username webauthn"
          icon={Mail}
          id="email"
          label="Email"
          placeholder="operator@trakrai.ai"
          type="email"
          value={email}
          onChange={setEmail}
        />

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <Label
              className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground"
              htmlFor="password"
            >
              Password
            </Label>
            <Link
              className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground transition-colors hover:text-foreground"
              href={`/auth/forgot-password?redirect=${searchParams.redirect}`}
            >
              Forgot password
            </Link>
          </div>
          <div className="relative">
            <KeyRound className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/75" />
            <Input
              autoComplete="current-password webauthn"
              className={`${fieldClassName} pl-11`}
              id="password"
              placeholder="Enter your password"
              required
              type="password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
              }}
            />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 border-y border-border/60 py-4">
        <div className="flex items-center gap-3">
          <Checkbox
            checked={remember}
            id="remember"
            onCheckedChange={(checked) => {
              setRemember(checked === true);
            }}
          />
          <Label className="text-sm font-normal text-muted-foreground" htmlFor="remember">
            Keep this device signed in
          </Label>
        </div>
        <p className="text-right text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          Redirects to dashboard
        </p>
      </div>

      <Button className={primaryButtonClassName} disabled={loading} type="submit">
        Open dashboard
      </Button>

      <div className="relative flex items-center py-2">
        <Separator className="flex-1 bg-border/70" />
        <span className="bg-background px-3 text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
          Alternative access
        </span>
        <Separator className="flex-1 bg-border/70" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Button
          className={secondaryButtonClassName}
          type="button"
          variant="outline"
          onClick={async () => {
            await signIn.social({
              provider: 'microsoft',
              callbackURL: searchParams.redirect,
            });
          }}
        >
          <svg className="size-4" viewBox="0 0 21 21">
            <rect fill="#f25022" height="9" width="9" x="1" y="1" />
            <rect fill="#00a4ef" height="9" width="9" x="1" y="11" />
            <rect fill="#7fba00" height="9" width="9" x="11" y="1" />
            <rect fill="#ffb900" height="9" width="9" x="11" y="11" />
          </svg>
          Azure AD
        </Button>
        <Button
          className={secondaryButtonClassName}
          disabled={!passkeyAvailable}
          type="button"
          variant="outline"
          onClick={() => {
            void signInUsingPasskey();
          }}
        >
          <Fingerprint className="size-4" />
          Passkey
        </Button>
      </div>

      <LinkHint
        href={`/auth/sign-up?redirect=${searchParams.redirect}`}
        label="Create an account"
        prefix="Need first-time access?"
      />
    </form>
  );
};

export const RegisterForm = () => {
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [searchParams] = useQueryStates({
    redirect: parseAsString.withDefault('/'),
  });

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    await signUp.email(
      {
        email,
        password,
        name,
        callbackURL: searchParams.redirect,
      },
      {
        onResponse: () => {
          setLoading(false);
        },
        onError: (ctx) => {
          toast.error(ctx.error.message);
        },
      },
    );
  };

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <div className="grid gap-4">
        <FormField
          autoComplete="name"
          icon={User2}
          id="name"
          label="Full name"
          placeholder="Safety operations lead"
          value={name}
          onChange={setName}
        />
        <FormField
          autoComplete="email"
          icon={Mail}
          id="email"
          label="Email"
          placeholder="name@company.com"
          type="email"
          value={email}
          onChange={setEmail}
        />
        <FormField
          autoComplete="new-password"
          icon={KeyRound}
          id="password"
          label="Password"
          placeholder="Choose a strong password"
          type="password"
          value={password}
          onChange={setPassword}
        />
      </div>

      <div className="border-y border-border/60 py-4">
        <p className="text-sm leading-6 text-muted-foreground">
          Your first successful sign-up can be elevated into the platform administrator for
          setting up hierarchy, device apps, and scoped user permissions.
        </p>
      </div>

      <Button className={primaryButtonClassName} disabled={loading} type="submit">
        Create account
      </Button>

      <LinkHint
        href={`/auth/sign-in?redirect=${searchParams.redirect}`}
        label="Sign in instead"
        prefix="Already have access?"
      />
    </form>
  );
};

export const ForgotPasswordForm = () => {
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [searchParams] = useQueryStates({
    redirect: parseAsString.withDefault('/'),
  });

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    await authClient.requestPasswordReset(
      {
        email,
        redirectTo: `/auth/reset-password?redirect=${searchParams.redirect}`,
      },
      {
        onResponse: () => {
          setLoading(false);
        },
        onError: (ctx) => {
          toast.error(ctx.error.message);
        },
        onSuccess: () => {
          toast.success('Check your email for password reset link');
        },
      },
    );
  };

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <FormField
        autoComplete="email"
        icon={Mail}
        id="email"
        label="Account email"
        placeholder="name@company.com"
        type="email"
        value={email}
        onChange={setEmail}
      />

      <div className="border-y border-border/60 py-4">
        <p className="text-sm leading-6 text-muted-foreground">
          We will send a secure reset link to the email above. The new password flow will
          return you to your requested destination after completion.
        </p>
      </div>

      <Button className={primaryButtonClassName} disabled={loading} type="submit">
        Send reset link
      </Button>

      <LinkHint href="/auth/sign-in" label="Back to sign in" prefix="Remembered your password?" />
    </form>
  );
};

export const ResetPasswordForm = () => {
  const [loading, setLoading] = useState(false);
  const [password, setPassword] = useState('');
  const [searchParams] = useQueryStates({
    redirect: parseAsString.withDefault('/'),
    token: parseAsString,
    error: parseAsString,
  });
  const router = useRouter();

  if (searchParams.token === null || searchParams.error !== null) {
    return (
      <div className="space-y-4 border border-destructive/25 bg-destructive/5 p-5 text-center">
        <p className="text-sm font-medium uppercase tracking-[0.22em] text-destructive">
          Invalid reset link
        </p>
        <p className="text-sm leading-6 text-muted-foreground">
          The token is missing or expired. Request a fresh reset email and try again.
        </p>
        <div>
          <Link
            className="text-sm font-medium underline underline-offset-4"
            href="/auth/forgot-password"
          >
            Request another link
          </Link>
        </div>
      </div>
    );
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    await authClient.resetPassword(
      {
        newPassword: password,
        token: searchParams.token ?? '',
      },
      {
        onResponse: () => {
          setLoading(false);
        },
        onError: (ctx) => {
          toast.error(ctx.error.message);
        },
        onSuccess: () => {
          toast.success('Password reset successfully');
          router.push(searchParams.redirect as Route);
        },
      },
    );
  };

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <FormField
        autoComplete="new-password"
        icon={KeyRound}
        id="password"
        label="New password"
        placeholder="Choose a new password"
        type="password"
        value={password}
        onChange={setPassword}
      />

      <div className="border-y border-border/60 py-4">
        <p className="text-sm leading-6 text-muted-foreground">
          After saving your new password, you will be returned to the requested TrakrAI
          destination and can continue into the dashboard.
        </p>
      </div>

      <Button className={primaryButtonClassName} disabled={loading} type="submit">
        Save new password
      </Button>
    </form>
  );
};
