import { useEffect, useState } from "react";

import { epgService, EMPTY_NOW_NEXT, NowNext } from "../services/epgService";
import type { Channel, Portal } from "../store/portalStore";

/**
 * Now/next for one channel, kept current.
 *
 * Two things move it: the guide arriving (either the bulk pass landing or this
 * channel's own short EPG being fetched) and simple passage of time, which the
 * service ticks every 30 s so a progress bar advances and a finished programme
 * rolls over to the next without the caller polling.
 *
 * Passing a portal opts the channel into an on-demand fetch when the bulk guide
 * did not cover it. The info bar does; a grid of a hundred tiles should not, or
 * it storms the portal with per-tile requests — those go through
 * `epgService.prefetch` for the visible page instead.
 */
export function useNowNext(
  channel: Channel | null | undefined,
  portal?: Portal | null
): NowNext {
  const [value, setValue] = useState<NowNext>(() => epgService.nowNext(channel));

  useEffect(() => {
    if (!channel) {
      setValue(EMPTY_NOW_NEXT);
      return;
    }

    let alive = true;
    const sync = () => {
      if (alive) setValue(epgService.nowNext(channel));
    };

    sync();
    const unsubscribe = epgService.subscribe(sync);
    if (portal) epgService.ensureChannel(portal, channel).then(sync).catch(() => { });

    return () => {
      alive = false;
      unsubscribe();
    };
    // The channel id is the identity that matters; callers rebuild the object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel?.id, channel?.epgId, portal?.id]);

  return value;
}

export default useNowNext;
