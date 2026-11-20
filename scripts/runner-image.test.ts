/**
 * Static checks on the runner image (T19) and its workflow: the image name
 * matches the app's `runnerImage()`, toolchains are pinned, the image runs as
 * uid 65534, and CI builds amd64 and arm64. The image itself is checked by
 * `runner-image/smoke.sh` and the real-Docker suites in the workflow.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');
const read = (p: string): string => readFileSync(join(root, p), 'utf8');
const dockerfile = read('runner-image/Dockerfile');
const workflow = read('.github/workflows/runner-image.yml');

describe('runner image', () => {
  it('is published under the name the app pulls', () => {
    const app = read('apps/desktop/src/main/exec/container/container-executor.ts');
    const name = /`(ghcr\.io\/[^:`]+):\$\{appVersion\}`/.exec(app)?.[1];
    expect(name).toBe('ghcr.io/hqazi/algorithm-tutor-runner');
    expect(workflow).toContain(`IMAGE: ${name}\n`);
  });

  it('pins every base image by version and digest', () => {
    const args = [...dockerfile.matchAll(/^ARG (\w+_IMAGE)=(\S+)$/gm)];
    expect(args.map((a) => a[1])).toEqual(['RUST_IMAGE', 'GO_IMAGE']);
    for (const [, , ref] of args)
      expect(ref).toMatch(/^[a-z]+:\d+\.\d+\.\d+-[\w-]+@sha256:[0-9a-f]{64}$/);
    const froms = [...dockerfile.matchAll(/^FROM (\S+)/gm)].map((m) => m[1]);
    expect(froms).toEqual(['${GO_IMAGE}', '${RUST_IMAGE}']);
  });

  it('runs as uid 65534', () => {
    expect(dockerfile).toMatch(/^USER 65534:65534$/m);
  });

  it('is built for amd64 and arm64, published on version tags and on dispatch', () => {
    expect(workflow).toMatch(/arch: amd64\n\s+runner: ubuntu-24\.04\n/);
    expect(workflow).toMatch(/arch: arm64\n\s+runner: ubuntu-24\.04-arm\n/);
    expect(workflow).toContain("tags: ['v*']");
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('runner-image/smoke.sh algorithm-tutor-runner:ci');
  });
});
