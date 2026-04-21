import React, { useEffect, useMemo, useState } from 'react';
import { UserProfile } from '../types';
import { listUsers, updateUser } from '../lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';

type EditableUser = UserProfile & {
  dirty?: boolean;
  saving?: boolean;
};

export function UserManagement() {
  const [users, setUsers] = useState<EditableUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;

    listUsers()
      .then((items) => {
        if (!cancelled) setUsers(items);
      })
      .catch((error) => {
        console.error('Failed to load users', error);
        toast.error('Failed to load users');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return users;
    return users.filter((user) =>
      user.displayName.toLowerCase().includes(query) ||
      user.email.toLowerCase().includes(query) ||
      user.role.toLowerCase().includes(query),
    );
  }, [search, users]);

  const updateDraft = (uid: string, patch: Partial<EditableUser>) => {
    setUsers((current) =>
      current.map((user) => (user.uid === uid ? { ...user, ...patch, dirty: true } : user)),
    );
  };

  const saveUser = async (user: EditableUser) => {
    setUsers((current) =>
      current.map((item) => (item.uid === user.uid ? { ...item, saving: true } : item)),
    );
    try {
      const updated = await updateUser(user.uid, {
        displayName: user.displayName,
        role: user.role,
        photoURL: user.photoURL,
      });
      setUsers((current) =>
        current.map((item) =>
          item.uid === user.uid ? { ...updated, dirty: false, saving: false } : item,
        ),
      );
      toast.success(`Updated ${updated.displayName}`);
    } catch (error) {
      console.error('Failed to save user', error);
      setUsers((current) =>
        current.map((item) => (item.uid === user.uid ? { ...item, saving: false } : item)),
      );
      toast.error(`Failed to update ${user.displayName}`);
    }
  };

  return (
    <div className="flex-1 overflow-hidden bg-white">
      <div className="h-16 bg-white border-b border-border-theme flex items-center justify-between px-6 shrink-0">
        <div>
          <h1 className="text-lg font-bold text-text-dark">User Management</h1>
          <p className="text-sm text-text-light">Manage names and roles for local accounts.</p>
        </div>
        <Input
          placeholder="Search users..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="w-[260px] bg-[#f1f5f9] border-border-theme h-9 text-sm"
        />
      </div>

      <div className="p-6 overflow-auto h-[calc(100vh-4rem)]">
        {loading ? (
          <div className="p-8 text-center text-text-light animate-pulse font-mono text-xs">
            LOADING USERS...
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="w-[120px]">Save</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredUsers.map((user) => (
                <TableRow key={user.uid}>
                  <TableCell className="align-top">
                    <Input
                      value={user.displayName}
                      onChange={(event) => updateDraft(user.uid, { displayName: event.target.value })}
                      className="w-full min-w-[220px]"
                    />
                  </TableCell>
                  <TableCell className="text-sm text-text-light align-middle">{user.email}</TableCell>
                  <TableCell className="align-top">
                    <Select value={user.role} onValueChange={(value: UserProfile['role']) => updateDraft(user.uid, { role: value })}>
                      <SelectTrigger className="w-[140px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="user">User</SelectItem>
                        <SelectItem value="agent">Agent</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="align-top">
                    <Button
                      onClick={() => saveUser(user)}
                      disabled={!user.dirty || user.saving}
                      size="sm"
                    >
                      {user.saving ? 'Saving...' : 'Save'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {filteredUsers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-text-light py-8">
                    No users found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
