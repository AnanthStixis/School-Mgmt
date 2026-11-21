import { IsEmail, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import type { LoginRequest, OtpRequest, OtpVerifyRequest, StudentLoginRequest } from '@sms/shared';

export class LoginDto implements LoginRequest {
  @IsEmail()
  @MaxLength(200)
  email!: string;

  @IsString()
  @Length(1, 200)
  password!: string;
}

export class OtpRequestDto implements OtpRequest {
  @IsString()
  @Length(10, 16)
  phone!: string;
}

export class OtpVerifyDto implements OtpVerifyRequest {
  @IsString()
  @Length(10, 16)
  phone!: string;

  @Matches(/^\d{6}$/, { message: 'code must be 6 digits' })
  code!: string;
}

export class StudentLoginDto implements StudentLoginRequest {
  @IsString()
  @Length(1, 40)
  loginId!: string;

  @IsString()
  @Length(1, 200)
  password!: string;
}

export class RefreshDto {
  /** Mobile clients send the refresh token in the body; web relies on the cookie. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  refreshToken?: string;
}
