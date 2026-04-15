import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes } from 'mongoose';
import { UserRole } from '../../users/schemas/user.schema';

export type AnalyticsEventDocument = HydratedDocument<AnalyticsEvent>;

@Schema({ timestamps: true })
export class AnalyticsEvent {
  @Prop({ required: true, index: true })
  eventType!: string;

  @Prop({ index: true })
  visitorId?: string;

  @Prop({ index: true })
  path?: string;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', index: true })
  userId?: string;

  @Prop()
  userName?: string;

  @Prop({ lowercase: true, trim: true })
  userEmail?: string;

  @Prop({ type: String, enum: Object.values(UserRole) })
  role?: UserRole;

  @Prop()
  ipAddress?: string;

  @Prop()
  userAgent?: string;

  @Prop()
  status?: string;

  @Prop({ type: SchemaTypes.Mixed })
  metadata?: Record<string, unknown>;
}

export const AnalyticsEventSchema = SchemaFactory.createForClass(AnalyticsEvent);
