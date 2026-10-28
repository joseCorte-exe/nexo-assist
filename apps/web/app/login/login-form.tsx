"use client";

import { corporateEmail, loginInput, loginResponse, resetPasswordResponse } from "@nexo/shared";
import { ArrowRight, Check, CircleAlert, Eye, EyeOff, LoaderCircle, LockKeyhole, Mail } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ComponentType, type FormEvent, type ReactNode, useId, useRef, useState } from "react";
import { callApi } from "@/lib/api-client";
import { homeOf } from "@/lib/route-guard";

type FieldErrors = { email?: string; password?: string };
type Feedback = { kind: "notice" | "alert"; text: string } | null;

export function LoginForm() {
  const router = useRouter();
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [pending, setPending] = useState<"login" | "reset" | null>(null);

  function focusFirstError(next: FieldErrors) {
    (next.email ? emailRef : passwordRef).current?.focus();
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    const parsed = loginInput.safeParse({
      email: form.get("email"),
      password: form.get("password"),
      remember: form.get("remember") === "on",
    });
    setFeedback(null);
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if ((field === "email" || field === "password") && !next[field]) next[field] = issue.message;
      }
      setErrors(next);
      focusFirstError(next);
      return;
    }

    setErrors({});
    setPending("login");
    const result = await callApi("POST", "/api/auth/login", loginResponse, parsed.data);
    if (result.ok) {
      // Keeps the button busy until the next page takes over.
      router.replace(homeOf(result.data.role));
      return;
    }
    setPending(null);
    if (result.code === "email_not_found") {
      setErrors({ email: result.message });
      emailRef.current?.focus();
    } else {
      setFeedback({ kind: "alert", text: result.message });
    }
  }

  async function onForgotPassword() {
    if (pending) return;
    setFeedback(null);
    const email = corporateEmail.safeParse(emailRef.current?.value ?? "");
    if (!email.success) {
      const message =
        emailRef.current?.value.trim() === "" ? "Digite seu e-mail corporativo para receber o link." : email.error.issues[0]?.message;
      setErrors({ email: message });
      emailRef.current?.focus();
      return;
    }
    setErrors({});
    setPending("reset");
    const result = await callApi("POST", "/api/me/reset-password", resetPasswordResponse, { email: email.data });
    setPending(null);
    setFeedback(result.ok ? { kind: "notice", text: result.data.notice } : { kind: "alert", text: result.message });
  }

  return (
    <form noValidate onSubmit={onSubmit} aria-busy={pending !== null} className="flex w-full max-w-[380px] flex-col gap-7">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-[40px] leading-[44px] font-normal tracking-[-0.8px] text-ink">Entrar</h1>
        <p className="text-15.5 leading-[23px] text-ink-3">Use seu e-mail corporativo e a senha da rede Nexo.</p>
      </div>

      <div className="flex flex-col gap-[18px]">
        <Field label="E-mail corporativo" error={errors.email} icon={Mail}>
          {(props) => (
            <input
              {...props}
              ref={emailRef}
              name="email"
              type="email"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              autoFocus
              placeholder="nome@nexo.com.br"
            />
          )}
        </Field>

        <Field
          label="Senha"
          error={errors.password}
          icon={LockKeyhole}
          action={
            <button
              type="button"
              onClick={onForgotPassword}
              disabled={pending === "reset"}
              className="rounded-sm text-13.5 font-medium whitespace-nowrap text-primary-text decoration-from-font underline-offset-2 hover:underline disabled:opacity-60"
            >
              Esqueci minha senha
            </button>
          }
        >
          {(props) => <PasswordInput {...props} inputRef={passwordRef} />}
        </Field>

        <Remember />
      </div>

      <button
        type="submit"
        className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-cta text-15.5 font-semibold text-white shadow-cta transition-[background-color,scale] duration-150 ease-out hover:bg-cta-hover active:scale-[0.96] aria-disabled:cursor-progress"
        aria-disabled={pending === "login"}
      >
        <span>{pending === "login" ? "Entrando" : "Entrar"}</span>
        <span className="relative size-4">
          <ArrowRight aria-hidden className="icon-swap absolute inset-0 size-4" data-hidden={pending === "login"} />
          <LoaderCircle aria-hidden className="icon-swap absolute inset-0 size-4 animate-spin" data-hidden={pending !== "login"} />
        </span>
      </button>

      <FormFeedback feedback={feedback} />
    </form>
  );
}

type InputProps = { id: string; "aria-invalid": boolean; "aria-describedby"?: string; className: string };

function Field({
  label,
  error,
  icon: Icon,
  action,
  children,
}: {
  label: string;
  error?: string;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  action?: ReactNode;
  children: (props: InputProps) => ReactNode;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="text-13.5 font-medium whitespace-nowrap text-ink">
          {label}
        </label>
        {action}
      </div>
      <div
        data-invalid={Boolean(error)}
        className="field group flex h-11 items-center gap-2.5 rounded-lg bg-white pr-2 pl-3.5 shadow-field outline-1 -outline-offset-[0.5px] outline-field transition-[outline-color,box-shadow] duration-150"
      >
        <Icon
          aria-hidden
          className="size-4 shrink-0 text-ink-3 transition-colors duration-150 group-focus-within:text-primary-text group-data-[invalid=true]:text-danger-text"
        />
        {children({
          id,
          "aria-invalid": Boolean(error),
          "aria-describedby": error ? errorId : undefined,
          className:
            "h-full min-w-0 flex-1 bg-transparent text-14.5 text-ink outline-none placeholder:text-ink-3/60",
        })}
      </div>
      {error ? (
        <p id={errorId} className="text-12.5 text-danger-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function PasswordInput({ inputRef, className, ...props }: InputProps & { inputRef: React.Ref<HTMLInputElement> }) {
  const [visible, setVisible] = useState(false);
  return (
    <>
      <input
        {...props}
        ref={inputRef}
        name="password"
        type={visible ? "text" : "password"}
        autoComplete="current-password"
        className={`${className} ${visible ? "" : "tracking-[2px]"}`}
      />
      <button
        type="button"
        onClick={() => setVisible((current) => !current)}
        aria-label={visible ? "Esconder senha" : "Mostrar senha"}
        aria-pressed={visible}
        className="relative grid size-[30px] shrink-0 place-items-center rounded-md text-ink-3 transition-colors duration-150 hover:bg-desk hover:text-ink-2"
      >
        <Eye aria-hidden className="icon-swap absolute size-4" data-hidden={visible} />
        <EyeOff aria-hidden className="icon-swap absolute size-4" data-hidden={!visible} />
      </button>
    </>
  );
}

function Remember() {
  return (
    <label className="flex w-fit cursor-pointer items-center gap-[9px] pt-0.5 text-13.5 whitespace-nowrap text-ink-2">
      <span className="relative grid size-[18px] shrink-0 place-items-center">
        {/* The real checkbox, restyled. Checked by default, as the design shows it. */}
        <input
          type="checkbox"
          name="remember"
          defaultChecked
          className="peer size-[18px] cursor-pointer appearance-none rounded-md bg-white outline-1 -outline-offset-[0.5px] outline-[#1B24313D] transition-colors duration-150 checked:bg-cta checked:outline-cta focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cta"
        />
        <Check
          aria-hidden
          className="pointer-events-none absolute size-3 text-white opacity-0 transition-opacity duration-150 peer-checked:opacity-100"
          strokeWidth={3}
        />
      </span>
      Manter conectado neste computador
    </label>
  );
}

/** The strip under the button, which the design keeps for messages that are not about one field. */
function FormFeedback({ feedback }: { feedback: Feedback }) {
  const Icon = feedback?.kind === "alert" ? CircleAlert : Mail;
  return (
    <div className="flex min-h-[31px] items-start gap-2 border-t border-rule pt-4 text-13">
      {/* Both live regions always exist, so screen readers announce what appears in them. */}
      <div role="status" className="contents">
        {feedback?.kind === "notice" ? <Message icon={Icon} className="text-ink-3" text={feedback.text} /> : null}
      </div>
      <div role="alert" className="contents">
        {feedback?.kind === "alert" ? <Message icon={Icon} className="text-danger-text" text={feedback.text} /> : null}
      </div>
    </div>
  );
}

function Message({ icon: Icon, text, className }: { icon: ComponentType<{ className?: string }>; text: string; className: string }) {
  return (
    <p className={`menu-enter flex items-start gap-2 text-pretty ${className}`}>
      <Icon className="mt-px size-3.5 shrink-0" />
      {text}
    </p>
  );
}
