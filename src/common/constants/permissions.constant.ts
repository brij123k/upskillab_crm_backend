export const PERMISSIONS = {
  LEAD: {
    MODULE: 'leads',
    ACTIONS: {
      CREATE: 'create',
      READ: 'read',
      UPDATE: 'update',
      DELETE: 'delete',
      ASSIGN: 'assign',
      POOLASSIGN:'pool_assign',
      STATUS_CHANGE: 'status_change',
      STAGE_CHANGE: 'stage_change',
      VIEW_HISTORY:'view_history'
    },
  },

  SOURCE_CAMPAIGN: {
    MODULE: 'source_campaigns',
    ACTIONS: {
      CREATE: 'create',
      READ: 'read',
      UPDATE: 'update',
      TOGGLE_STATUS: 'toggle_status',
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
      USER_ACTIVITY: 'user_activity',
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
  },
  Orders:{
    MODULE:'orders',
    ACTIONS:{
      CREATE:'create',
      READ:'read',
      UPDATE:'update',
      APPROVE:'approve',
      LOANS:'read_loans',
      SENDREMINDERS:'send_reminders',
      PAYMENTLINKGENERATOR:'payment_link_generator',
      READPAYMENTHISTORY:'read_payment_history',
    }
  },
  LOANPARTNER:{
    MODULE:'loan_partner',
    ACTIONS:{
      CREATE:'create',
      READ:'read',
      UPDATE:'update',
      APPROVE:'approve',
      TOGGLESTATUS:'toggle_status',
    }
  },
  TASK:{
    MODULE:'task',
    ACTIONS:{
      CREATE:'create',
      READ:'read',
      UPDATE:'update',
      CHANGE_STATUS:'change_status',
    }
  },
  ANNOUNCEMENT:{
    MODULE:'announcement',
    ACTIONS:{
      CREATE:'create',
      READ:'read',
    }
  },
  REPORTS:{
    MODULE:'reports',
    ACTIONS:{
      READ:'read',
      EXPORT:'export',
      GENERATE:'generate',
      SHARE:'share',
      SALARY_SHEET:'salary_sheet',
    }
  },
  TARGETS:{
    MODULE:'targets',
    ACTIONS:{
      CREATE:'create',
      READ:'read',
      UPDATE:'update',
      COPY:'copy',
    }
  },
  LEAVE:{
    MODULE:'leave',
    ACTIONS:{
      APPROVE:'approve',
    }
  }
} as const;
