'use server';

import type React from 'react';

import { SES, type SendEmailCommandInput } from '@aws-sdk/client-ses';
import { render } from '@react-email/components';

import { env } from '@/lib/env';

import { config } from './aws-config';

export const sendSESEmail = async (
  to: string[],
  subject: string,
  emailBody: React.ReactElement,
) => {
  const emailHtml = await render(emailBody);
  const emailText = await render(emailBody, {
    plainText: true,
  });

  const ses = new SES(config);
  const params: SendEmailCommandInput = {
    Source: env.EMAIL_SENDER_ADDRESS,
    Destination: {
      ToAddresses: to,
    },
    Message: {
      Body: {
        Html: { Data: emailHtml },
        Text: { Data: emailText },
      },
      Subject: {
        Data: subject,
      },
    },
  };

  const response = await ses.sendEmail(params);
  const messageId = response.MessageId;
  if (messageId === undefined || messageId === '') {
    throw new Error('SES did not return a message id');
  }

  return { messageId };
};
