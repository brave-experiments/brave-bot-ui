# Why setup looks like this

The commands are in the [README](../README.md). This is the reasoning behind the two parts
of it that look like more ceremony than they need: the pinned submodule and the credentials
file outside every checkout.

## Why the agent is a pinned submodule

`crates/bravebot-bridge` depends on the agent by path — `../../vendor/bravebot/crates/*` — so
a clone without submodules leaves an empty directory and nothing compiles.
`scripts/build-bridge.sh` says so rather than letting cargo report a missing `Cargo.toml`.

The pin is the point. The bridge builds against the agent's internals, which carry no
compatibility promise: a field added to a struct it constructs is a build break here, with
nothing changed on this side. Before the submodule that break arrived at whatever moment a
developer next pulled the sibling checkout. Now it arrives when somebody moves the pin
deliberately:

```bash
git -C vendor/bravebot fetch origin
git -C vendor/bravebot checkout <rev>       # or origin/main
cargo test --all                            # the upgrade is a test pass, not a version bump
git add vendor/bravebot && git commit
```

CI compiles the pinned revision too, from one checkout with `submodules: true`, so an
upstream commit cannot turn this repository red on its own and a bump of the pin is a pull
request that CI runs before it lands.

After a `git pull` that moves the pin, run `git submodule update` — git leaves the submodule
where it was, and the build that follows would otherwise compile an agent nobody chose.
`npm run bridge` warns when the two disagree.

## Why the credentials live outside every checkout

The [README's Credentials section](../README.md#credentials) recommends keeping the values in
`~/.config/bravebot/env` and reading them from a `.envrc` here. Putting them in
`vendor/bravebot/.envrc` also works, and `BRAVEBOT_DIR` can still point at an older sibling
checkout instead. Three things follow from preferring the file outside:

- **The secret outlives the checkout it was for.** A `.envrc` inside the agent's tree is one
  `git clean -xdff`, or one re-clone, away from being gone, and what you lose is the one file
  you cannot get back from a remote. The agent's move from a sibling checkout to a submodule
  is the same lesson already collected once: that path changed, and anything kept under it
  had to move with it.
- **One file feeds the build and the run.** The build bakes the values in; separately, the
  agent lets a variable present at run time override a baked one, so an app started from
  this shell reaches the backend even when the binary it spawns was built without
  credentials. Those are two different failure modes and this answers both.
- **One copy of the secret, in a directory no `git add -A` can reach.** `.envrc` is in this
  repository's `.gitignore`, which matters more here than in the agent's tree: there, the
  agent's own `.gitignore` was already covering for you.

`BRAVEBOT_DIR` — and `BUA_AGENT_DIR`, which some shell profiles still set from before the
agent was renamed — are credentials only: cargo compiles the submodule either way. The path
is resolved to its real one, because direnv's allow list is keyed on the physical path and a
checkout reached through a symlink otherwise reads as un-allowed however many times you allow
it.
