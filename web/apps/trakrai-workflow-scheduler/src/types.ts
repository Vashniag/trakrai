export interface CronFlowTrigger {
  cronExpression: string;
  cronTriggerId: string;
  flowId: string;
  nodeId: string;
}

export interface FlowTriggerNotification {
  cronExpression?: string | null;
  cronTriggerId?: string;
  flowId?: string;
  id: string;
  nodeId?: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  type?: string;
}

export interface FlowJobData {
  cronTriggerId: string;
  flowId: string;
  nodeId: string;
}
