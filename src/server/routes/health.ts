import { Router } from "express";

const router = Router();

router.get("/", (_req, res) => {
  res.json({
    success: true,
    data: {
      status: "ok",
      services: ["pdf-reconstruction", "video-analyzer"],
    },
  });
});

export default router;
