import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from './entities/order.entity';
import { StatusChange } from './entities/status-change.entity';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OtpModule } from '../otp/otp.module';
import { StlStorageModule } from '../storage/stl-storage.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, StatusChange]),
    OtpModule,
    StlStorageModule,
  ],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
