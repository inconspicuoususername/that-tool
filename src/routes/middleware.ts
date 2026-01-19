import { env } from "@/lib/env";
import express from "express";
import jwt from "jsonwebtoken";

export const requireJWT = (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7)
      : req.query.token || req.cookies?.token;

    if (!token || typeof token !== "string") {
      res.status(401);
      return;
    }

    try {
      jwt.verify(token, env.auth.jwtSecret);
      res.locals.jwt = token;
      next();
    } catch (error) {
      res.status(401);
      return;
    }
  };
