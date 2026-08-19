# Frozen demo

The [interactive Doot demo](https://oddship.github.io/doot/demo/) is a static snapshot of the product experience with deterministic fictional messages. It is safe to explore: there is no backend, provider key, account credential, SQLite database, network request, or mailbox mutation path.

The demo is generated rather than edited as deployment output:

```bash
npm run demo:build
npm run demo:screenshot
```

`demo/index.html` contains the deterministic semantic fixture, while `scripts/build-static-demo.mjs` incorporates the real Doot application stylesheet and product mark into `_site/demo`. The screenshot command opens that exact generated output in Chromium and writes the README image.

Changes to the application visual system or demo fixtures trigger the Pages workflow. CI also builds the demo, catching missing inputs and malformed generation before publication.
