import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { NotificationService } from './notification.service';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  /* =============================
     LIST
  ============================== */
  @Get()
  async list(
    @Req() req,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.notificationService.list(
      req.user.userId,
      Number(page),
      Number(limit),
    );
  }

  /* =============================
     UNREAD COUNT
  ============================== */
  @Get('unread-count')
  async unreadCount(@Req() req) {
    return this.notificationService.unreadCount(req.user.userId);
  }

  /* =============================
     MARK ONE AS READ
  ============================== */
  @Patch(':id/read')
  async markAsRead(@Req() req, @Param('id') id: string) {
    return this.notificationService.markAsRead(req.user.userId, id);
  }

  /* =============================
     MARK ALL AS READ
  ============================== */
  @Patch('read-all')
  async markAllAsRead(@Req() req) {
    return this.notificationService.markAllAsRead(req.user.userId);
  }
}
