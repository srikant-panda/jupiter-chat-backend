import { Router } from "express";
import {
  handleRenderDiagram,
  handleValidateDiagram,
} from "../controllers/diagram.controller.js";

const router = Router();

router.post("/render", handleRenderDiagram);
router.post("/validate", handleValidateDiagram);

export default router;
