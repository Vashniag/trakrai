'use server';

import type React from 'react';

import { render } from '@react-email/components';
import nodemailer from 'nodemailer';

import { env } from '@/lib/env';

export const sendEmail = async (to: string[], subject: string, emailBody: React.ReactElement) => {
  const emailHtml = await render(emailBody);
  const emailText = await render(emailBody, {
    plainText: true,
  });
  const transporter = nodemailer.createTransport({
    host: env.SMTP_SERVER,
    port: 587,
    secure: false,
    requireTLS: true,
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASSWORD,
    },
  });

  const response = await transporter.sendMail({
    from: env.EMAIL_SENDER_ADDRESS,
    to,
    subject,
    html: emailHtml,
    text: emailText,
  });

  const { messageId } = response;
  if (messageId === '') {
    throw new Error('SMTP transport did not return a message id');
  }
  return { messageId };
};
