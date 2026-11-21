import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ANNOUNCEMENT_AUDIENCES, ANNOUNCEMENT_BODY_MAX, ANNOUNCEMENT_PRIORITIES, ANNOUNCEMENT_TITLE_MAX, type AnnouncementAudience, type AnnouncementDto, type AnnouncementInput, type AnnouncementPriority, type AudiencePreview, type ChannelsDto, type NotificationFeedDto } from '@sms/shared';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, Length } from 'class-validator';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser, RequireModule, Roles } from '../auth/decorators';
import { AnnouncementsService } from './announcements.service';
import { NotificationsService } from './notifications.service';

/** Everyone's own notification feed (the bell on the website, Notices in the app). */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  feed(@CurrentUser() user: AuthUser): Promise<NotificationFeedDto> {
    return this.notifications.feed(user);
  }

  @Get('channels')
  @Roles('manager', 'teacher', 'accounts')
  channels(): ChannelsDto {
    return this.notifications.channels();
  }

  @Post('read-all')
  @HttpCode(200)
  readAll(@CurrentUser() user: AuthUser): Promise<{ marked: number }> {
    return this.notifications.markAllRead(user);
  }

  @Post(':id/read')
  @HttpCode(204)
  read(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<void> {
    return this.notifications.markRead(user, id);
  }
}

class AudienceDto {
  @IsOptional() @IsString() branchId!: string | null;
  @IsIn(ANNOUNCEMENT_AUDIENCES) audience!: AnnouncementAudience;
  @IsOptional() @IsArray() @ArrayMaxSize(60) @IsString({ each: true }) classIds?: string[];
  @IsBoolean() sms!: boolean;
  @IsBoolean() email!: boolean;
}

class AnnouncementDtoIn implements AnnouncementInput {
  @IsOptional() @IsString() branchId!: string | null;
  @IsString() @Length(3, ANNOUNCEMENT_TITLE_MAX, { message: `Title must be 3 to ${ANNOUNCEMENT_TITLE_MAX} characters` }) title!: string;
  @IsString() @Length(1, ANNOUNCEMENT_BODY_MAX, { message: `Message must be 1 to ${ANNOUNCEMENT_BODY_MAX} characters` }) body!: string;
  @IsIn(ANNOUNCEMENT_AUDIENCES) audience!: AnnouncementAudience;
  @IsOptional() @IsArray() @ArrayMaxSize(60) @IsString({ each: true }) classIds?: string[];
  @IsIn(ANNOUNCEMENT_PRIORITIES) priority!: AnnouncementPriority;
  @IsBoolean() pinned!: boolean;
  @IsBoolean() sms!: boolean;
  @IsBoolean() email!: boolean;
}

/** Announcements: managers and class teachers send; everyone reads what they received. */
@Controller('announcements')
@RequireModule('communication')
export class AnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<AnnouncementDto[]> {
    return this.announcements.list(user);
  }

  /** How many people (and SMS / e-mails) an announcement would reach. Sends nothing. */
  @Post('preview')
  @HttpCode(200)
  @Roles('manager', 'teacher')
  preview(@CurrentUser() user: AuthUser, @Body() dto: AudienceDto): Promise<AudiencePreview> {
    return this.announcements.preview(user, { ...dto, branchId: dto.branchId ?? null });
  }

  @Post()
  @Roles('manager', 'teacher')
  create(@CurrentUser() user: AuthUser, @Body() dto: AnnouncementDtoIn): Promise<AnnouncementDto> {
    return this.announcements.create(user, { ...dto, branchId: dto.branchId ?? null });
  }

  @Post(':id/withdraw')
  @HttpCode(200)
  @Roles('manager', 'teacher')
  withdraw(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<AnnouncementDto> {
    return this.announcements.withdraw(user, id);
  }
}
