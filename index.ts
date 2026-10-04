import { app } from "./src/app";

export default { port: Number(process.env.PORT ?? 3000), fetch: app.fetch };
