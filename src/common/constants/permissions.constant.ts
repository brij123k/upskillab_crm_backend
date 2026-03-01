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
    MODULE:'Calls',
    ACTIONS:{
      CREATE:'create',
      READ:'read',
    }
  },
  Meeting:{
    MODULE:'Meetings',
    ACTIONS:{
      CREATE:'create',
      READ:'read',
      FEEDBACK:'feedback'
    }
  }
} as const;
