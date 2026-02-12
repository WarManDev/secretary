import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import messageProcessor from '../services/messageProcessor.js';

const router = express.Router();

/**
 * POST /api/chat
 * Universal chat endpoint - тестирование messageProcessor
 */
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { message, platform = 'api' } = req.body;

    if (!message) {
      return res.status(400).json({
        status: 'fail',
        message: 'Message text required',
      });
    }

    const result = await messageProcessor.processMessage({
      userId: req.user.id,
      messageText: message,
      platform,
      messageType: 'text',
      metadata: { source: 'rest_api' },
    });

    res.json({
      status: 'success',
      data: result,
    });
  })
);

export default router;
