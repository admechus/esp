#ifndef NODE_ROLES_H
#define NODE_ROLES_H

typedef enum {
  NODE_ROLE_IDENTITY = 0,
  NODE_ROLE_GATEWAY = 1,
  NODE_ROLE_PEER = 2,
  NODE_ROLE_RELAY = 3,
  NODE_ROLE_WORKER = 4,
  NODE_ROLE_OBSERVER = 5
} node_role_t;

#endif
