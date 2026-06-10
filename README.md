# Backstop

**37 detections. 4 are blind. Backstop is the one alert that fires when an alert can't.**

> An AI agent reads your real saved-search detections, works out the exact data each one
> needs to fire, then probes your live indexes to prove which detections have gone silently
> blind — and ranks the blind ones by the attack they were the only thing guarding.

Backstop is a Security-track app for **Splunk Cloud**. It watches the watchers. The mechanic
is small and the contract is the whole product: **a detection's health is computed from the
real last-seen timestamp of the data it actually depends on — not asserted by a model, and
re-derivable by you in your own search bar.** We call that contract **proof-by-silence**: a
green detection flips to BLIND the moment its data stops, stamped with the timestamp of the
last row it will ever see.

---

## The one money shot
