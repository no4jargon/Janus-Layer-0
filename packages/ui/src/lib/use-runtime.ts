import { useEffect, useState } from 'react';

type Snapshot = Awaited<
  ReturnType<NonNullable<typeof window.janusApi>['getRuntimeState']>
>;

type WaEvent = Parameters<
  NonNullable<typeof window.janusApi>['events']['onWhatsAppEvent']
>[0] extends (event: infer T) => void
  ? T
  : never;

type ConnectorEvent = Parameters<
  NonNullable<typeof window.janusApi>['events']['onConnectorEvent']
>[0] extends (event: infer T) => void
  ? T
  : never;

export const useRuntimeSnapshot = () => {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);

  useEffect(() => {
    if (!window.janusApi) return;
    let mounted = true;

    window.janusApi
      .getRuntimeState()
      .then((value) => {
        if (mounted) setSnapshot(value);
      })
      .catch(() => {
        /* surface via UI elsewhere */
      });

    const unsubscribe = window.janusApi.events.onRuntimeSnapshot((next) => {
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
    if (!window.janusApi) return;
    const unsubscribe = window.janusApi.events.onWhatsAppEvent(handler);
    return unsubscribe;
  }, [handler]);
};

export const useConnectorEvents = (
  handler: (event: ConnectorEvent) => void,
) => {
  useEffect(() => {
    if (!window.janusApi) return;
    const unsubscribe = window.janusApi.events.onConnectorEvent(handler);
    return unsubscribe;
  }, [handler]);
};
