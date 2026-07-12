// Loopback transport pair for headless gates: same interface as the WebRTC
// transport, with a virtual clock and simulated one-way latency.
export function createVirtualClock() {
  let t = 0;
  return {
    now: () => t,
    advance: (ms, drainFns) => {
      t += ms;
      for (const fn of drainFns ?? []) fn();
    },
  };
}

export function createLoopbackPair(clock, latencyMs = 40) {
  const queues = { a2b: [], b2a: [] };
  const make = (outQueue, inQueue) => {
    const handlers = [];
    const closeHandlers = [];
    let closed = false;
    return {
      peerId: '',
      send: (channel, data) => {
        if (closed) return;
        outQueue.push({ at: clock.now() + latencyMs, channel, data: data.slice(0) });
      },
      onMessage: (cb) => handlers.push(cb),
      onClose: (cb) => closeHandlers.push(cb),
      close: () => { closed = true; for (const cb of closeHandlers) cb(); },
      _drain: () => {
        while (inQueue.length && inQueue[0].at <= clock.now() && !closed) {
          const m = inQueue.shift();
          for (const cb of handlers) cb(m.channel, m.data);
        }
      },
      _closed: () => closed,
    };
  };
  const a = make(queues.a2b, queues.b2a);
  const b = make(queues.b2a, queues.a2b);
  return [a, b];
}
