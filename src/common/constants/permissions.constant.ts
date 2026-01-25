export const PERMISSIONS = {
  LEAD: {
    MODULE: 'lead',
    ACTIONS: {
      CREATE: 'create',
      READ: 'read',
      UPDATE: 'update',
      DELETE: 'delete',
      ASSIGN: 'assign',
      STATUS_CHANGE: 'status_change',
    },
  },

  USER: {
    MODULE: 'user',
    ACTIONS: {
      CREATE: 'create',
      READ: 'read',
      UPDATE: 'update',
      DELETE: 'delete',
      BLOCK: 'block',
    },
  },

  ROLE: {
    MODULE: 'role',
    ACTIONS: {
      CREATE: 'create',
      READ: 'read',
      UPDATE: 'update',
      DELETE: 'delete',
    },
  },

  DEPARTMENT: {
    MODULE: 'department',
    ACTIONS: {
      CREATE: 'create',
      READ: 'read',
      UPDATE: 'update',
      DELETE: 'delete',
    },
  },
} as const;
