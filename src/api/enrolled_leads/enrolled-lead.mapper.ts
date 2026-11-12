/**
 * Maps the Upskillab /external/crm/students payload to CRM documents.
 * Pure functions (no database access) so they are easy to test.
 */

const str = (value: any): string | undefined =>
  value === undefined || value === null || value === ''
    ? undefined
    : String(value);

/** Id of a value that may be a plain id or a populated object. */
export const idOf = (value: any): string | undefined => {
  if (value && typeof value === 'object') return str(value._id ?? value.id);
  return str(value);
};

const toDate = (value: any): Date | undefined => {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

const toNumber = (value: any): number | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

const nameOf = (value: any): string | undefined => {
  if (value && typeof value === 'object') {
    return str(
      value.name ?? value.categoryName ?? value.languageName ?? value.title,
    );
  }
  return str(value);
};

const unique = (values: (string | undefined)[]): string[] => [
  ...new Set(values.filter((v): v is string => !!v)),
];

const labelList = (value: any): string[] =>
  Array.isArray(value)
    ? unique(
        value.map((item) =>
          item && typeof item === 'object'
            ? str(item.batchCode ?? item.courseName ?? item.name ?? idOf(item))
            : str(item),
        ),
      )
    : [];

/** Batch statuses are compared case-insensitively. */
export const normalizeBatchStatus = (value: any): string | undefined => {
  const s = str(value)?.trim().toLowerCase();
  return s || undefined;
};

/** Upstream fields of an enrolled lead (never the CRM fields). */
export function mapStudent(student: any) {
  const orders: any[] = Array.isArray(student?.orders) ? student.orders : [];
  const completedBatches = labelList(student?.completedBatches);
  const ongoingBatches = labelList(student?.ongoingBatches);
  const upcomingBatches = labelList(student?.upcomingBatches);

  const status = str(student?.status);
  let isActive: boolean | undefined =
    typeof student?.isActive === 'boolean' ? student.isActive : undefined;
  if (isActive === undefined && status) {
    const lower = status.toLowerCase();
    if (lower === 'active') isActive = true;
    if (lower === 'inactive') isActive = false;
  }

  return {
    studentId:
      idOf(student?.studentId) ?? idOf(student?.userId) ?? idOf(student?._id),
    userId: idOf(student?.userId),
    email: str(student?.email)?.toLowerCase(),
    mobileNumber: str(student?.mobileNumber),
    username: str(student?.username),
    userType: str(student?.userType),
    isActive,
    status,
    fullName: str(student?.fullName) ?? str(student?.username),
    college: str(student?.college),
    studentType: str(student?.studentType),
    bio: str(student?.bio),
    skills: Array.isArray(student?.skills) ? student.skills.map(String) : [],
    image: str(student?.image),
    studentCreatedAt: toDate(student?.createdAt),
    studentUpdatedAt: toDate(student?.updatedAt),
    courses: unique([
      ...labelList(student?.courses),
      ...orders.map((o) => str(o?.courseId?.courseName ?? o?.courseName)),
    ]),
    courseIds: unique(orders.map((o) => idOf(o?.courseId))),
    batches: unique([
      ...labelList(student?.batches),
      ...orders.map((o) => str(o?.batchId?.batchCode)),
    ]),
    batchIds: unique(orders.map((o) => idOf(o?.batchId))),
    completedBatches,
    ongoingBatches,
    upcomingBatches,
    batchStatuses: unique([
      ...orders.map((o) => normalizeBatchStatus(o?.batchStatus)),
      completedBatches.length ? 'completed' : undefined,
      ongoingBatches.length ? 'ongoing' : undefined,
      upcomingBatches.length ? 'upcoming' : undefined,
    ]),
    paymentSummary:
      student?.paymentSummary && typeof student.paymentSummary === 'object'
        ? student.paymentSummary
        : {},
    orders,
    raw: student ?? {},
  };
}

export function mapCourse(course: any) {
  return {
    upskillabId: idOf(course?._id) ?? idOf(course?.id),
    courseName: str(course?.courseName ?? course?.name ?? course?.title),
    category: nameOf(course?.category),
    language: nameOf(course?.language),
    data: course ?? {},
  };
}

export function mapBatch(batch: any, courseNames: Map<string, string>) {
  const courseId = idOf(batch?.course ?? batch?.courseId);
  const teacher = batch?.teacher;
  return {
    upskillabId: idOf(batch?._id) ?? idOf(batch?.id),
    batchCode: str(batch?.batchCode ?? batch?.code ?? batch?.name),
    courseId,
    courseName:
      str(
        batch?.course?.courseName ??
          batch?.courseId?.courseName ??
          batch?.courseName,
      ) ?? (courseId ? courseNames.get(courseId) : undefined),
    teacherName:
      teacher && typeof teacher === 'object' ? str(teacher.name) : str(teacher),
    status: normalizeBatchStatus(batch?.status),
    active: typeof batch?.active === 'boolean' ? batch.active : undefined,
    startDate: toDate(batch?.startDate),
    endDate: toDate(batch?.endDate),
    startTime: str(batch?.startTime),
    duration: str(batch?.duration),
    seats: toNumber(batch?.seats),
    enrolledStudents: toNumber(batch?.enrolledStudents),
    paidStudents: toNumber(batch?.paidStudents),
    totalOrders: toNumber(batch?.totalOrders),
    data: batch ?? {},
  };
}
