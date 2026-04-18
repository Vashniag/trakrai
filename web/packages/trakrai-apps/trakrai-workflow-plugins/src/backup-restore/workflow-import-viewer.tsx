'use client';

import { useCallback, useState } from 'react';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@trakrai/design-system/components/accordion';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@trakrai/design-system/components/card';
import { FileImage, Upload, Workflow } from 'lucide-react';
import extract from 'png-chunks-extract';

import type { WorkflowData } from '@trakrai-workflow/core';

const extractWorkflow = (arrayBuffer: ArrayBuffer): WorkflowData | null => {
  try {
    const bytes = new Uint8Array(arrayBuffer);
    const chunks = extract(bytes) as Array<{ name: string; data: Uint8Array }>;
    const textChunk = chunks.find((chunk) => {
      if (chunk.name !== 'tEXt') return false;
      let keywordEnd = 0;
      while (keywordEnd < chunk.data.length && chunk.data[keywordEnd] !== 0) {
        keywordEnd++;
      }
      const keyword = String.fromCharCode(...Array.from(chunk.data.slice(0, keywordEnd)));
      return keyword === 'WorkflowData';
    });
    if (textChunk === undefined) {
      return null;
    }
    let keywordEnd = 0;
    while (keywordEnd < textChunk.data.length && textChunk.data[keywordEnd] !== 0) {
      keywordEnd++;
    }
    const jsonData = String.fromCharCode(...Array.from(textChunk.data.slice(keywordEnd + 1)));
    return JSON.parse(jsonData) as WorkflowData;
  } catch {
    return null;
  }
};

const formatValue = (value: unknown): string => {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value, null, 2);
};

const getNodeConnections = (nodeId: string, workflowData: WorkflowData) => {
  const incoming = workflowData.edges.filter((edge) => edge.target === nodeId);
  const outgoing = workflowData.edges.filter((edge) => edge.source === nodeId);

  return { incoming, outgoing };
};

/**
 * Standalone viewer for PNG exports created by {@link ExportImageButton}.
 *
 * It extracts the embedded `WorkflowData` metadata client-side and renders a read-only inspection UI
 * without needing a live Fluxery editor instance.
 */
export const WorkflowImportViewer = () => {
  const [workflowData, setWorkflowData] = useState<WorkflowData | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const extractWorkflowFromPNG = useCallback(
    (arrayBuffer: ArrayBuffer) => extractWorkflow(arrayBuffer),
    [],
  );

  const handleFileUpload = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file === undefined) return;

      setError(null);

      // Validate file type
      if (!file.type.startsWith('image/png')) {
        setError('Please upload a PNG file');
        return;
      }

      try {
        // Create image preview URL
        const url = URL.createObjectURL(file);
        setImageUrl(url);

        // Read file and extract workflow data
        const arrayBuffer = await file.arrayBuffer();
        const workflow = extractWorkflowFromPNG(arrayBuffer);

        if (workflow === null) {
          setError(
            'No workflow data found in this PNG. Make sure it was exported from this editor.',
          );
          setWorkflowData(null);
          return;
        }

        setWorkflowData(workflow);
      } catch (err) {
        setError(`Failed to process file: ${err instanceof Error ? err.message : String(err)}`);
        setWorkflowData(null);
      }
    },
    [extractWorkflowFromPNG],
  );
  return (
    <div className="flex h-full w-full flex-col gap-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle>Import Workflow from PNG</CardTitle>
          <CardDescription>
            Upload a PNG file exported from the workflow editor to view its structure
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            <label
              className="border-muted-foreground/20 hover:border-primary hover:bg-accent flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 transition-colors"
              htmlFor="file-upload"
            >
              <Upload className="text-muted-foreground h-8 w-8" />
              <div className="text-center">
                <p className="text-sm font-medium">Click to upload PNG</p>
                <p className="text-muted-foreground text-xs">or drag and drop</p>
              </div>
              <input
                accept="image/png"
                className="hidden"
                id="file-upload"
                type="file"
                onChange={handleFileUpload}
              />
            </label>

            {error !== null && error !== '' ? (
              <div className="bg-destructive/10 text-destructive rounded-lg p-3 text-sm">
                {error}
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {imageUrl !== null && imageUrl !== '' ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileImage className="h-4 w-4" />
              Image Preview
            </CardTitle>
          </CardHeader>
          <CardContent>
            <img alt="Workflow preview" className="max-h-96 w-full object-contain" src={imageUrl} />
          </CardContent>
        </Card>
      ) : null}

      {workflowData !== null ? <WorkflowViewer workflowData={workflowData} /> : null}
    </div>
  );
};

const WorkflowViewer = ({ workflowData }: { workflowData: WorkflowData }) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Workflow className="h-4 w-4" />
          Workflow Structure
        </CardTitle>
        <CardDescription>
          {workflowData.nodes.length} nodes, {workflowData.edges.length} edges
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Accordion className="w-full" type="multiple">
          {workflowData.nodes.map((node, index) => {
            const connections = getNodeConnections(node.id, workflowData);
            return (
              <AccordionItem key={node.id} value={node.id}>
                <AccordionTrigger>
                  <div className="flex flex-col items-start gap-1">
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground text-xs">#{index + 1}</span>
                      <span className="font-semibold">{node.type ?? 'Unknown'}</span>
                    </div>
                    <span className="text-muted-foreground text-xs">ID: {node.id}</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="flex flex-col gap-4 pt-2">
                    {/* Position */}
                    <div>
                      <h4 className="text-muted-foreground mb-2 text-xs font-medium uppercase">
                        Position
                      </h4>
                      <div className="bg-muted rounded-md p-3 text-xs">
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <span className="text-muted-foreground">X:</span> {node.position.x}
                          </div>
                          <div>
                            <span className="text-muted-foreground">Y:</span> {node.position.y}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Configuration */}
                    {node.data.configuration !== null &&
                    node.data.configuration !== undefined &&
                    Object.keys(node.data.configuration).length > 0 ? (
                      <div>
                        <h4 className="text-muted-foreground mb-2 text-xs font-medium uppercase">
                          Configuration
                        </h4>
                        <div className="bg-muted flex flex-col gap-2 rounded-md p-3">
                          {Object.entries(node.data.configuration).map(([key, value]) => (
                            <div key={key} className="flex flex-col gap-1">
                              <span className="text-xs font-medium">{key}:</span>
                              <pre className="bg-background rounded p-2 text-xs whitespace-pre-wrap">
                                {formatValue(value)}
                              </pre>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {/* Connections */}
                    {connections.incoming.length > 0 || connections.outgoing.length > 0 ? (
                      <div>
                        <h4 className="text-muted-foreground mb-2 text-xs font-medium uppercase">
                          Connections
                        </h4>
                        <div className="flex flex-col gap-3">
                          {connections.incoming.length > 0 ? (
                            <div>
                              <p className="text-muted-foreground mb-1 text-xs font-medium">
                                Incoming ({connections.incoming.length}):
                              </p>
                              <div className="bg-muted flex flex-col gap-1 rounded-md p-2">
                                {connections.incoming.map((edge) => (
                                  <div key={edge.id} className="text-xs">
                                    <span className="font-medium">
                                      {workflowData.nodes.find((n) => n.id === edge.source)?.type}
                                    </span>
                                    <span className="text-muted-foreground"> ({edge.source})</span>
                                    {edge.sourceHandle !== null && edge.sourceHandle !== '' ? (
                                      <span className="text-muted-foreground">
                                        {' '}
                                        via {edge.sourceHandle}
                                      </span>
                                    ) : null}
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}

                          {connections.outgoing.length > 0 ? (
                            <div>
                              <p className="text-muted-foreground mb-1 text-xs font-medium">
                                Outgoing ({connections.outgoing.length}):
                              </p>
                              <div className="bg-muted flex flex-col gap-1 rounded-md p-2">
                                {connections.outgoing.map((edge) => (
                                  <div key={edge.id} className="text-xs">
                                    <span className="font-medium">
                                      {workflowData.nodes.find((n) => n.id === edge.target)?.type}
                                    </span>
                                    <span className="text-muted-foreground"> ({edge.target})</span>
                                    {edge.targetHandle !== null && edge.targetHandle !== '' ? (
                                      <span className="text-muted-foreground">
                                        {' '}
                                        via {edge.targetHandle}
                                      </span>
                                    ) : null}
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ) : null}

                    {/* Measured dimensions */}
                    {node.measured !== undefined ? (
                      <div>
                        <h4 className="text-muted-foreground mb-2 text-xs font-medium uppercase">
                          Dimensions
                        </h4>
                        <div className="bg-muted rounded-md p-3 text-xs">
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <span className="text-muted-foreground">Width:</span>{' '}
                              {node.measured.width}px
                            </div>
                            <div>
                              <span className="text-muted-foreground">Height:</span>{' '}
                              {node.measured.height}px
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      </CardContent>
    </Card>
  );
};
