import { Router } from "express";
import { INSTANCE_NAME, INSTANCE_STARTED_AT } from "../instanceName.js";

const router = Router();

router.get("/", (_req, res) => {
  res.json({
    success: true,
    data: {
      status: "ok",
      instance: INSTANCE_NAME,
      startedAt: INSTANCE_STARTED_AT,
      services: ["pdf-reconstruction", "video-analyzer"],
    },
  });
});

export default router;
