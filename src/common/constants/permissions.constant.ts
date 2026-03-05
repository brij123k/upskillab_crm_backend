export const PERMISSIONS = {
  LEAD: {
    MODULE: 'leads',
    ACTIONS: {
      CREATE: 'create',
      READ: 'read',
      UPDATE: 'update',
      DELETE: 'delete',
      ASSIGN: 'assign',
      STATUS_CHANGE: 'status_change',
      STAGE_CHANGE: 'stage_change',
      VIEW_HISTORY:'view_history'
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
  Calls:{
    MODULE:'call_logs',
    ACTIONS:{
      CREATE:'create',
      READ:'read',
    }
  },
  Meeting:{
    MODULE:'meeting_logs',
    ACTIONS:{
      CREATE:'create',
      READ:'read',
      FEEDBACK:'feedback'
    }
  },
  POOL:{
    MODULE:'pool',
    ACTIONS:{
      CREATE:'create',
      READ:'read',
      UPDATE:'update',
    }
  }
} as const;
