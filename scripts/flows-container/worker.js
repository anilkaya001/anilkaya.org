import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";

export class NightlyFixture extends DurableObject {
  async verify() {
    const container = this.ctx.container;
    if (!container.running) container.start({ enableInternet: false });
    await container.monitor();
    return { status: "passed" };
  }
}

export default class NightlyFixtureService extends WorkerEntrypoint {
  async verify() {
    return this.env.NIGHTLY_FIXTURE.getByName("golden").verify();
  }

  async scheduled() {
    await this.verify();
  }

  fetch() {
    return new Response(null, { status: 404 });
  }
}
