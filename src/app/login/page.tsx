"use client";
import { Form, Field } from "@/components/ui";
export default function Login() {
  return (
    <main className="login paper">
      <a href="/">H & R</a>
      <p className="eyebrow">BEHIND THE CELEBRATION</p>
      <h1>Welcome back.</h1>
      <p>Sign in to your wedding workspace.</p>
      <Form action="login" onDone={() => location.assign("/admin")}>
        <Field label="Email" name="email" type="email" required />
        <Field label="Password" name="password" type="password" required />
      </Form>
    </main>
  );
}
