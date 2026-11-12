import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import axios from 'axios';

export interface UpskillabStudentsResponse {
  students: any[];
  courses: any[];
  batches: any[];
}

const PAGE_SIZE = 500;
const MAX_PAGES = 200;

/**
 * Client for the Upskillab backend: GET /external/crm/students.
 *
 * Env:
 *   UPSKILLAB_API_URL      default https://api.upskillab.com
 *   UPSKILLAB_CRM_API_KEY  the CRM_API_KEY set on the Upskillab backend
 */
@Injectable()
export class UpskillabClient {
  private readonly logger = new Logger(UpskillabClient.name);

  get isConfigured(): boolean {
    return !!process.env.UPSKILLAB_CRM_API_KEY;
  }

  private get baseUrl(): string {
    return (
      process.env.UPSKILLAB_API_URL || 'https://api.upskillab.com'
    ).replace(/\/+$/, '');
  }

  /** Every student (all pages), plus every course and batch. */
  async fetchAllStudents(): Promise<UpskillabStudentsResponse> {
    const apiKey = process.env.UPSKILLAB_CRM_API_KEY;
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'UPSKILLAB_CRM_API_KEY is not set on the CRM backend',
      );
    }

    const students: any[] = [];
    let courses: any[] = [];
    let batches: any[] = [];

    for (let page = 1; page <= MAX_PAGES; page++) {
      let data: any;
      try {
        const res = await axios.get(`${this.baseUrl}/external/crm/students`, {
          headers: { 'x-api-key': apiKey },
          params: { status: 'all', limit: PAGE_SIZE, page },
          timeout: 120_000,
        });
        data = res.data;
      } catch (error: any) {
        const status = error?.response?.status;
        const message =
          error?.response?.data?.message || error?.message || 'request failed';
        this.logger.error(
          `Upskillab students page ${page} failed: ${status} ${message}`,
        );
        throw new ServiceUnavailableException(
          `Could not fetch students from Upskillab${status ? ` (HTTP ${status})` : ''}: ${message}`,
        );
      }

      if (!data || data.success === false || !Array.isArray(data.students)) {
        throw new ServiceUnavailableException(
          'Unexpected response from Upskillab /external/crm/students',
        );
      }

      students.push(...data.students);
      if (page === 1) {
        courses = Array.isArray(data.courses) ? data.courses : [];
        batches = Array.isArray(data.batches) ? data.batches : [];
      }

      const totalPages = Number(data.pagination?.totalPages) || 1;
      if (page >= totalPages || data.students.length === 0) break;
    }

    return { students, courses, batches };
  }
}
