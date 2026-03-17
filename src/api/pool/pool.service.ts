import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CreatePoolDto } from 'src/dto/pool.dto';
import { Pool } from 'src/schema/Pool.schema';

export class PoolService {
  constructor(
    @InjectModel(Pool.name)
    private readonly poolModel: Model<Pool>,
  ) {}

async createPool(data: CreatePoolDto) {
  try {
    const pool = await this.poolModel.create(data);
    return pool;
  } catch (error) {
    // Duplicate key error
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      throw new BadRequestException(`${field} already exists`);
    }

    // Validation errors
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map((err: any) => err.message);
      throw new BadRequestException(messages);
    }

    throw new InternalServerErrorException('Something went wrong while creating pool');
  }
}

async findAllPools() {
  return await this.poolModel
    .find().populate('pool_owner','name employeeId email number');
}
 async findPoolById(id: string) {
    return await this.poolModel.findById(id).populate('pool_owner','name employeeId email number');
  }
 async updateById(id: string, data: any) {
    return await this.poolModel.findByIdAndUpdate(id, data, { new: true });
  }  
async toggelActive(id: string) {
    const ishas = await this.poolModel.findById(id)
    if(!ishas){
        return {message:"pool not found"}
    }
    return await this.poolModel.findByIdAndUpdate(id,{isActive:!ishas.isActive}, { new: true });
  }  
}
