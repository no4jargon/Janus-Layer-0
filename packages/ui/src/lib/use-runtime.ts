import { useEffect, useState } from 'react';

type Snapshot = Awaited<
  ReturnType<NonNullable<typeof window.workspaceApi>['getRuntimeState']>
>;

type WaEvent = Parameters<
  NonNullable<typeof window.workspaceApi>['events']['onWhatsAppEvent']
>[0] extends (event: infer T) => void
  ? T
  : never;

type ConnectorEvent = Parameters<
  NonNullable<typeof window.workspaceApi>['events']['onConnectorEvent']
>[0] extends (event: infer T) => void
  ? T
  : never;

export const useRuntimeSnapshot = () => {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);

  useEffect(() => {
    if (!window.workspaceApi) return;
    let mounted = true;

    window.workspaceApi
      .getRuntimeState()
      .then((value) => {
        if (mounted) setSnapshot(value);
      })
      .catch(() => {
        /* surface via UI elsewhere */
      });

    const unsubscribe = window.workspaceApi.events.onRuntimeSnapshot((next) => {
      if (mounted) setSnapshot(next);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  return [snapshot, setSnapshot] as const;
};

export const useWhatsAppEvents = (handler: (event: WaEvent) => void) => {
  useEffect(() => {
    if (!window.workspaceApi) return;
    const unsubscribe = window.workspaceApi.events.onWhatsAppEvent(handler);
    return unsubscribe;
  }, [handler]);
};

export const useConnectorEvents = (
  handler: (event: ConnectorEvent) => void,
) => {
  useEffect(() => {
    if (!window.workspaceApi) return;
    const unsubscribe = window.workspaceApi.events.onConnectorEvent(handler);
    return unsubscribe;
  }, [handler]);
};
