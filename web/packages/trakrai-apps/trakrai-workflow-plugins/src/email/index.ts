export { defaultJsonEmailDocument, defaultJsonEmailInputSchema } from './defaults';
export { resolveJsonEmailDocument } from './document';
export { JsonEmailNodeHandler } from './json-email-node-handler';
export { renderJsonEmail, isJsonEmailSpec } from './render-json-email';
export { SendEmailNodeHandler } from './send-email-node-handler';
export { jsonEmailSpecialField } from './special-field';
export type {
  JsonEmailRenderResult,
  JsonEmailTemplateDocument,
  SendEmailResult,
  SendJsonEmailArgs,
} from './types';
