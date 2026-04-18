'use client';

export type ServiceContractOutputKind = 'error' | 'event' | 'success';

type TypeCarriers<TSchema> = Readonly<{
  __schema?: TSchema;
}>;

export type ServiceContractOutput<
  TSchema,
  TKind extends ServiceContractOutputKind = ServiceContractOutputKind,
  TMessageType extends string = string,
  TSubtopic extends string = string,
> = TypeCarriers<TSchema> &
  Readonly<{
    kind: TKind;
    messageType: TMessageType;
    subtopic: TSubtopic;
  }>;

type MethodTypeCarriers<TRequest extends Record<string, unknown>> = Readonly<{
  __request?: TRequest;
}>;

export type ServiceContractMethod<
  TRequest extends Record<string, unknown>,
  TOutputs extends readonly ServiceContractOutput<
    unknown,
    ServiceContractOutputKind,
    string,
    string
  >[],
> = MethodTypeCarriers<TRequest> &
  Readonly<{
    aliases: readonly string[];
    outputs: TOutputs;
    subtopic: string;
  }>;

export type ServiceContract<
  TName extends string,
  TMethods extends Readonly<
    Record<
      string,
      ServiceContractMethod<
        Record<string, unknown>,
        readonly ServiceContractOutput<unknown, ServiceContractOutputKind, string, string>[]
      >
    >
  >,
> = Readonly<{
  methods: TMethods;
  name: TName;
}>;

type ServiceContractMethodBase = ServiceContractMethod<
  Record<string, unknown>,
  readonly ServiceContractOutput<unknown, ServiceContractOutputKind, string, string>[]
>;

export type BaseServiceContract = ServiceContract<
  string,
  Readonly<Record<string, ServiceContractMethodBase>>
>;

export const defineServiceContractOutput = <
  TSchema,
  TKind extends ServiceContractOutputKind = ServiceContractOutputKind,
  TMessageType extends string = string,
  TSubtopic extends string = string,
>(
  output: Readonly<{
    kind: TKind;
    messageType: TMessageType;
    subtopic: TSubtopic;
  }>,
): ServiceContractOutput<TSchema, TKind, TMessageType, TSubtopic> =>
  output as ServiceContractOutput<TSchema, TKind, TMessageType, TSubtopic>;

export const defineServiceContractMethod = <
  TRequest extends Record<string, unknown>,
  TOutputs extends readonly ServiceContractOutput<
    unknown,
    ServiceContractOutputKind,
    string,
    string
  >[] = readonly ServiceContractOutput<unknown, ServiceContractOutputKind, string, string>[],
>(
  method: Readonly<{
    aliases?: readonly string[];
    outputs: TOutputs;
    subtopic: string;
  }>,
): ServiceContractMethod<TRequest, TOutputs> =>
  ({
    aliases: method.aliases ?? [],
    outputs: method.outputs,
    subtopic: method.subtopic,
  }) as ServiceContractMethod<TRequest, TOutputs>;

export const defineServiceContract = <
  TName extends string,
  TMethods extends Readonly<Record<string, ServiceContractMethodBase>>,
>(
  contract: Readonly<{
    methods: TMethods;
    name: TName;
  }>,
): ServiceContract<TName, TMethods> => contract as ServiceContract<TName, TMethods>;

export type ServiceContractMethodName<TContract extends BaseServiceContract> =
  keyof TContract['methods'] & string;

export type ServiceContractMethodRequest<
  TContract extends BaseServiceContract,
  TMethod extends ServiceContractMethodName<TContract>,
> = NonNullable<TContract['methods'][TMethod]['__request']>;

export type ServiceContractMethodOutputUnion<
  TContract extends BaseServiceContract,
  TMethod extends ServiceContractMethodName<TContract>,
> = TContract['methods'][TMethod]['outputs'][number];

type ResponseSuccessPayload<
  TContract extends BaseServiceContract,
  TMethod extends ServiceContractMethodName<TContract>,
> = Extract<
  ServiceContractMethodOutputUnion<TContract, TMethod>,
  {
    kind: 'success';
    subtopic: 'response';
  }
>['__schema'];

type ResponseErrorPayload<
  TContract extends BaseServiceContract,
  TMethod extends ServiceContractMethodName<TContract>,
> = Extract<
  ServiceContractMethodOutputUnion<TContract, TMethod>,
  {
    kind: 'error';
    subtopic: 'response';
  }
>['__schema'];

export type ServiceContractResponseMethodName<TContract extends BaseServiceContract> = {
  [TMethod in ServiceContractMethodName<TContract>]: [
    ResponseSuccessPayload<TContract, TMethod>,
  ] extends [never]
    ? never
    : TMethod;
}[ServiceContractMethodName<TContract>] &
  string;

export type ServiceContractNotifyMethodName<TContract extends BaseServiceContract> = Exclude<
  ServiceContractMethodName<TContract>,
  ServiceContractResponseMethodName<TContract>
>;

export type ServiceContractMethodSuccessPayload<
  TContract extends BaseServiceContract,
  TMethod extends ServiceContractResponseMethodName<TContract>,
> = NonNullable<ResponseSuccessPayload<TContract, TMethod>>;

export type ServiceContractMethodErrorPayload<
  TContract extends BaseServiceContract,
  TMethod extends ServiceContractResponseMethodName<TContract>,
> = NonNullable<ResponseErrorPayload<TContract, TMethod>>;

type ServiceContractOutputUnion<TContract extends BaseServiceContract> = {
  [TMethod in ServiceContractMethodName<TContract>]: ServiceContractMethodOutputUnion<
    TContract,
    TMethod
  >;
}[ServiceContractMethodName<TContract>];

export type ServiceContractEventMessageType<TContract extends BaseServiceContract> =
  ServiceContractOutputUnion<TContract> extends infer TOutput
    ? TOutput extends {
        kind: 'event';
        messageType: infer TMessageType extends string;
      }
      ? TMessageType
      : never
    : never;

export type ServiceContractEventPayload<
  TContract extends BaseServiceContract,
  TMessageType extends ServiceContractEventMessageType<TContract>,
> = Extract<
  ServiceContractOutputUnion<TContract>,
  {
    kind: 'event';
    messageType: TMessageType;
  }
>['__schema'];

export type ServiceContractEventSubtopic<
  TContract extends BaseServiceContract,
  TMessageType extends ServiceContractEventMessageType<TContract>,
> = Extract<
  ServiceContractOutputUnion<TContract>,
  {
    kind: 'event';
    messageType: TMessageType;
  }
>['subtopic'];

export const getServiceContractMethod = <
  TContract extends BaseServiceContract,
  TMethod extends ServiceContractMethodName<TContract>,
>(
  contract: TContract,
  method: TMethod,
): TContract['methods'][TMethod] => {
  const methodDefinition = contract.methods[method];
  if (methodDefinition === undefined) {
    throw new Error(`Unknown service contract method: ${String(method)}`);
  }

  return methodDefinition as TContract['methods'][TMethod];
};

export const getServiceContractResponseOutputs = <
  TContract extends BaseServiceContract,
  TMethod extends ServiceContractResponseMethodName<TContract>,
>(
  contract: TContract,
  method: TMethod,
): Array<
  Extract<ServiceContractMethodOutputUnion<TContract, TMethod>, { subtopic: 'response' }>
> => {
  const {
    outputs,
  }: { outputs: ReadonlyArray<ServiceContractMethodOutputUnion<TContract, TMethod>> } =
    getServiceContractMethod(contract, method);
  return Array.from(outputs).filter(
    (
      output: ServiceContractMethodOutputUnion<TContract, TMethod>,
    ): output is Extract<
      ServiceContractMethodOutputUnion<TContract, TMethod>,
      { subtopic: 'response' }
    > => output.subtopic === 'response',
  );
};

export const getServiceContractEventOutput = <
  TContract extends BaseServiceContract,
  TMessageType extends ServiceContractEventMessageType<TContract>,
>(
  contract: TContract,
  messageType: TMessageType,
): Extract<
  ServiceContractOutputUnion<TContract>,
  {
    kind: 'event';
    messageType: TMessageType;
  }
> | null => {
  const methods = Object.values(contract.methods) as Array<
    TContract['methods'][ServiceContractMethodName<TContract>]
  >;

  for (const method of methods) {
    const eventOutput = method.outputs.find(
      (
        output: ServiceContractOutputUnion<TContract>,
      ): output is Extract<
        ServiceContractOutputUnion<TContract>,
        {
          kind: 'event';
          messageType: TMessageType;
        }
      > => output.kind === 'event' && output.messageType === messageType,
    );
    if (eventOutput !== undefined) {
      return eventOutput;
    }
  }

  return null;
};
