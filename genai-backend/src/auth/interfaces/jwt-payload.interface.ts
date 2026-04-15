import { UserRole } from '../../users/schemas/user.schema';

export interface JwtPayload {
  sub: string;
  email: string;
  name: string;
  role: UserRole;
}
