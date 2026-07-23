import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CreateOrderDto } from './dto/create-order.dto';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import {
  OrderDetailResponseDto,
  PaginatedOrdersDto,
} from './dto/order-response.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { OrdersService, StlDownloadLink } from './orders.service';
import { StaffApiKeyGuard } from './staff-api-key.guard';
import { MAX_STL_BYTES } from './stl.validation';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('stl', {
      storage: memoryStorage(),
      // Multer aborts the stream past this, so an oversized upload is never
      // fully buffered. Surfaces as 413 via the exception filter.
      limits: { fileSize: MAX_STL_BYTES, files: 1, fields: 10 },
    }),
  )
  async create(
    @Body() body: CreateOrderDto,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<{ id: string; barcode: string; status: string }> {
    const order = await this.ordersService.create({
      phone: body.phone,
      verificationToken: body.verificationToken,
      optionsJson: body.options,
      file,
    });

    // `barcode` is additive; existing clients reading { id, status } are unaffected.
    return { id: order.id, barcode: order.barcode, status: order.status };
  }

  @Get()
  @UseGuards(StaffApiKeyGuard)
  findAll(@Query() query: ListOrdersQueryDto): Promise<PaginatedOrdersDto> {
    return this.ordersService.findAll(query);
  }

  @Get(':id')
  @UseGuards(StaffApiKeyGuard)
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OrderDetailResponseDto> {
    return this.ordersService.findOneDetail(id);
  }

  /**
   * Returns a short-lived presigned S3 URL for the order's STL. The browser
   * downloads straight from S3, so the bucket stays private and the bytes never
   * pass through this server. `404` if the object is gone.
   */
  @Get(':id/stl')
  @UseGuards(StaffApiKeyGuard)
  downloadStl(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<StlDownloadLink> {
    return this.ordersService.getStlDownloadLink(id);
  }

  /**
   * Permanently deletes the order, its audit trail, and its STL file. There is
   * no soft-delete and nothing to restore from — the dashboard gates this
   * behind a typed confirmation.
   */

  @Delete(':id')
  @UseGuards(StaffApiKeyGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.ordersService.remove(id);
  }

  @Patch(':id/status')
  @UseGuards(StaffApiKeyGuard)
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateOrderStatusDto,
  ): Promise<OrderDetailResponseDto> {
    return this.ordersService.updateStatus(id, body.status);
  }
}
