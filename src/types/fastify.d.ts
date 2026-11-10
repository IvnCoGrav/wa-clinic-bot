import 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    tenantId?: string;
    staffSession?: {
      id: string;
      staffId: string;
      tenantId: string;
      name?: string;
      role?: string;
      [key: string]: any;
    };
    adminIdentity?: string;
    adminKeyUsed?: string;
    adminUser?: {
      name?: string;
      email?: string;
      role?: string;
      [key: string]: any;
    };
    staffName?: string;
  }
}
