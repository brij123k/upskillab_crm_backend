import {
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import {
  WHATSAPP_ENDPOINTS,
  WHATSAPP_HEADERS,
} from './whatsapp.constants'
import { SendTemplateDto } from './dto/send-template.dto';
@Injectable()
export class WhatsappService {
  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

private get baseUrl(): string {
    return this.configService.get<string>('UDO_BASE_URL') || '';
}

private get headers() {
  return {
    [WHATSAPP_HEADERS.API_KEY]:
      this.configService.get<string>('UDO_API_KEY'),
    [WHATSAPP_HEADERS.CONTENT_TYPE]:
      WHATSAPP_HEADERS.APPLICATION_JSON,
  };
}

async getTemplates() {
  try {
    const url = `${this.baseUrl}/waTemplateList`;
    const response = await firstValueFrom(
      this.httpService.post(
        url,
        {},
        {
          headers: this.headers,
        },
      ),
    );
    return response.data;
  } catch (error: any) {
    console.log(error?.response?.data);

    throw new InternalServerErrorException(
      error?.response?.data?.message ||
        'Unable to fetch templates',
    );
  }
}

async getTemplateById(id: string) {
  try {
    const url = `${this.baseUrl}/getWaTemplate`;

    const response = await firstValueFrom(
      this.httpService.post(
        url,
        {
          id,
        },
        {
          headers: this.headers,
        },
      ),
    );

    return response.data;
  } catch (error: any) {
    console.log('========== ERROR ==========');
    console.log(error?.response?.data);
    console.log('===========================');

    throw new InternalServerErrorException(
      error?.response?.data?.message ||
        error?.message ||
        'Unable to fetch template',
    );
  }
}

async sendTemplate(data: SendTemplateDto) {
  try {
    const url = `${this.baseUrl}`;

    const response = await firstValueFrom(
      this.httpService.post(url, data, {
        headers: this.headers,
      }),
    );

    return response.data;
  } catch (error: any) {
    console.log(error?.response?.data);

    throw new InternalServerErrorException(
      error?.response?.data?.message ||
        'Unable to send message',
    );
  }
}
}