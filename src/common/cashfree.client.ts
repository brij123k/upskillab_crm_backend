import { Injectable, BadRequestException } from '@nestjs/common';
import axios, { AxiosRequestConfig, Method } from 'axios';

@Injectable()
export class CashfreeClient {
  private readonly baseUrl = process.env.CASHFREE_BASE_URL;

  private getHeaders() {
    return {
      'x-client-id': process.env.CASHFREE_APP_ID,
      'x-client-secret': process.env.CASHFREE_SECRET_KEY,
      'x-api-version': '2023-08-01',
      'Content-Type': 'application/json',
    };
  }

  // 🔥 Generic request handler
  async request<T = any>(
    method: Method,
    endpoint: string,
    data?: any,
    customHeaders?: Record<string, string>,
  ): Promise<T> {
    try {
      const config: AxiosRequestConfig = {
        method,
        url: `${this.baseUrl}${endpoint}`,
        headers: {
          ...this.getHeaders(),
          ...customHeaders,
        },
        data,
      };

      const response = await axios(config);

      return response.data;
    } catch (error) {
      throw new BadRequestException(
        error.response?.data || 'Cashfree API Error',
      );
    }
  }
}