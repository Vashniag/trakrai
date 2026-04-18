'use client';

import { type ReactNode, useMemo, useState } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@trakrai/design-system/components/alert-dialog';
import { Button } from '@trakrai/design-system/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@trakrai/design-system/components/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@trakrai/design-system/components/table';
import { EMPTY_OBJECT_SCHEMA } from '@trakrai-workflow/core';
import { createDisplayName } from '@trakrai-workflow/core/utils';
import {
  OutputHandlesRenderer,
  SchemaNodeShell,
  useFlow,
  useNodeSchemaData,
  useTRPCPluginAPIs,
} from '@trakrai-workflow/ui';
import { useNodeId } from '@xyflow/react';

import type { HttpTriggerPlugin } from './http-trigger-plugin';

type HttpToken = {
  createdAt: Date;
  displayToken: string;
  id: string;
  lastUsedAt: Date | null;
};

const formatTimestamp = (value: Date | null) => {
  if (value === null) {
    return 'Never';
  }
  return new Date(value).toLocaleString();
};

export const HttpTriggerNode = () => {
  const nodeId = useNodeId();
  const {
    nodeRuntime,
    flow: { nodes, edges },
    isReadOnly,
  } = useFlow();
  const { resolvedNodeSchema } = useNodeSchemaData({
    id: nodeId,
    edges,
    nodeRuntime,
    nodes,
  });

  const nodeData = useMemo(() => {
    if (nodeId === null) {
      return null;
    }
    return nodes.find((node) => node.id === nodeId) ?? null;
  }, [nodeId, nodes]);

  const nodeType = nodeData?.type;
  const title = nodeType !== undefined && nodeType !== '' ? createDisplayName(nodeType) : 'Merge';

  const outputJson = useMemo(() => {
    if (resolvedNodeSchema !== undefined) {
      return resolvedNodeSchema.output;
    }
    return EMPTY_OBJECT_SCHEMA;
  }, [resolvedNodeSchema]);

  return (
    <SchemaNodeShell className="w-72" title={title}>
      <div className="grid grid-cols-1 gap-2 py-2">
        <OutputHandlesRenderer outputJson={outputJson} tooltipEnabled={!isReadOnly} />
      </div>
      <div className="flex flex-col border-t px-2 pt-2">
        <Dialog>
          <DialogTrigger asChild>
            <Button>Manage Http Tokens</Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto sm:max-w-4xl">
            <DialogHeader>
              <DialogTitle>Manage Http Tokens</DialogTitle>
              <DialogDescription>
                Manage your HTTP tokens required for triggering this workflow. You can create
                multiple tokens and revoke them when they are no longer needed.
              </DialogDescription>
            </DialogHeader>
            <TokensTable nodeId={nodeId ?? ''} />
          </DialogContent>
        </Dialog>
      </div>
    </SchemaNodeShell>
  );
};

const TokensTable = ({ nodeId }: { nodeId: string }) => {
  const { extras } = useFlow();
  const queryClient = useQueryClient();
  const { client: trpc } = useTRPCPluginAPIs<HttpTriggerPlugin>('http-trigger');
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [tokenToRevoke, setTokenToRevoke] = useState<HttpToken | null>(null);
  const isNodeReady = nodeId !== '';
  const listTokensQueryOptions = trpc.listTokens.queryOptions({ nodeId, extras });
  const {
    data: tokens,
    error,
    isLoading,
  } = useQuery({
    ...listTokensQueryOptions,
    enabled: isNodeReady,
  });

  const createTokenMutation = useMutation({
    ...trpc.createToken.mutationOptions(),
    onError: (mutationError) => {
      setErrorMessage(mutationError.message);
    },
    onSuccess: async (data) => {
      setCreatedToken(data.token);
      setErrorMessage(null);
      await queryClient.invalidateQueries({ queryKey: listTokensQueryOptions.queryKey });
    },
  });

  const deleteTokenMutation = useMutation({
    ...trpc.deleteToken.mutationOptions(),
    onError: (mutationError) => {
      setErrorMessage(mutationError.message);
    },
    onSuccess: async () => {
      setErrorMessage(null);
      setTokenToRevoke(null);
      await queryClient.invalidateQueries({ queryKey: listTokensQueryOptions.queryKey });
    },
  });

  const handleCreateToken = async () => {
    setErrorMessage(null);
    try {
      await createTokenMutation.mutateAsync({ nodeId, extras });
    } catch {
      // Mutation errors are surfaced through onError state above.
    }
  };

  const handleRevokeToken = async () => {
    if (tokenToRevoke === null) {
      return;
    }
    setErrorMessage(null);
    try {
      await deleteTokenMutation.mutateAsync({ id: tokenToRevoke.id });
    } catch {
      // Mutation errors are surfaced through onError state above.
    }
  };

  if (!isNodeReady) {
    return <p className="text-muted-foreground text-sm">Token management is unavailable.</p>;
  }

  let tableRows: ReactNode;
  if (isLoading) {
    tableRows = (
      <TableRow>
        <TableCell className="text-muted-foreground" colSpan={4}>
          Loading tokens...
        </TableCell>
      </TableRow>
    );
  } else if ((tokens?.length ?? 0) === 0) {
    tableRows = (
      <TableRow>
        <TableCell className="text-muted-foreground" colSpan={4}>
          No HTTP tokens created yet.
        </TableCell>
      </TableRow>
    );
  } else {
    tableRows = tokens?.map((token) => (
      <TableRow key={token.id}>
        <TableCell className="font-mono">{token.displayToken}</TableCell>
        <TableCell>{formatTimestamp(token.createdAt)}</TableCell>
        <TableCell>{formatTimestamp(token.lastUsedAt)}</TableCell>
        <TableCell>
          <Button
            disabled={deleteTokenMutation.isPending}
            size="sm"
            variant="destructive"
            onClick={() => {
              setTokenToRevoke(token);
            }}
          >
            Revoke
          </Button>
        </TableCell>
      </TableRow>
    ));
  }

  return (
    <>
      <div className="flex flex-col gap-4">
        <div className="flex justify-end">
          <Button disabled={createTokenMutation.isPending} onClick={() => void handleCreateToken()}>
            {createTokenMutation.isPending ? 'Creating...' : 'Create Token'}
          </Button>
        </div>
        {createdToken !== null ? (
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">New token</p>
            <p className="font-mono text-xs break-all">{createdToken}</p>
            <p className="text-muted-foreground text-xs">
              Copy this token now. It will not be shown again.
            </p>
          </div>
        ) : null}
        {errorMessage !== null ? <p className="text-destructive text-xs">{errorMessage}</p> : null}
        {error !== null ? <p className="text-destructive text-xs">{error.message}</p> : null}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Token</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Last Used</TableHead>
              <TableHead className="w-24">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>{tableRows}</TableBody>
        </Table>
      </div>
      <AlertDialog
        open={tokenToRevoke !== null}
        onOpenChange={(open) => {
          if (!open) {
            setTokenToRevoke(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke token?</AlertDialogTitle>
            <AlertDialogDescription>
              This will immediately revoke{' '}
              <span className="font-mono">{tokenToRevoke?.displayToken}</span>. Any clients using it
              will stop working.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteTokenMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteTokenMutation.isPending}
              variant="destructive"
              onClick={(event) => {
                event.preventDefault();
                void handleRevokeToken();
              }}
            >
              {deleteTokenMutation.isPending ? 'Revoking...' : 'Revoke Token'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
