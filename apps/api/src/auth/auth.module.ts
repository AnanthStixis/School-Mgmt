import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AccessGuard, JwtAuthGuard } from './guards';
import { ConsoleSmsSender, SMS_SENDER } from './sms';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 300 }]),
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.getOrThrow<string>('JWT_SECRET');
        if (secret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters');
        return { secret, signOptions: { issuer: 'sms-api' }, verifyOptions: { issuer: 'sms-api' } };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    {
      provide: SMS_SENDER,
      useFactory: () => {
        if (process.env.NODE_ENV === 'production') {
          throw new Error('No SMS provider configured: the development console sender must not run in production');
        }
        return new ConsoleSmsSender();
      },
    },
    // Order matters: rate limit → authenticate → authorise.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: AccessGuard },
  ],
  exports: [AuthService, SMS_SENDER],
})
export class AuthModule {}
