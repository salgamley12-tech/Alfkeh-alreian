import React, { useEffect, useState } from 'react';
import { Alert, FlatList, Modal, Platform, Pressable, SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import * as SQLite from 'expo-sqlite';

const database = SQLite.openDatabaseAsync('sales-debts.db');
const C = { bg: '#f5f7fb', card: '#fff', ink: '#172033', muted: '#718096', blue: '#3157d5', border: '#e5e9f2', green: '#17834b', red: '#c83e4d' };
const today = () => new Date().toISOString().slice(0, 10);
const money = (n) => Number(n || 0).toLocaleString('ar', { maximumFractionDigits: 2 });

async function init() {
  const db = await database;
  await db.execAsync(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS customers(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,phone TEXT DEFAULT '',created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sales(id INTEGER PRIMARY KEY AUTOINCREMENT,customer_id INTEGER,item TEXT NOT NULL,quantity REAL NOT NULL,unit_price REAL NOT NULL,total REAL NOT NULL,payment TEXT NOT NULL,sale_date TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS debts(id INTEGER PRIMARY KEY AUTOINCREMENT,customer_id INTEGER NOT NULL,description TEXT NOT NULL,amount REAL NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS payments(id INTEGER PRIMARY KEY AUTOINCREMENT,debt_id INTEGER NOT NULL,amount REAL NOT NULL,payment_date TEXT NOT NULL);`);
}

function Button({ title, onPress, secondary = false }) {
  return (
    <Pressable onPress={onPress} style={[s.button, secondary && s.secondary]}>
      <Text style={[s.buttonText, secondary && { color: C.blue }]}>{title}</Text>
    </Pressable>
  );
}

function Field({ label, value, onChangeText, keyboardType }) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <TextInput value={value} onChangeText={onChangeText} keyboardType={keyboardType} placeholder={label} placeholderTextColor="#9aa4b5" textAlign="right" style={s.input} />
    </View>
  );
}

export default function App() {
  const [tab, setTab] = useState('home');
  const [customers, setCustomers] = useState([]);
  const [sales, setSales] = useState([]);
  const [debts, setDebts] = useState([]);
  const [summary, setSummary] = useState({ allSales: 0, todaySales: 0, remaining: 0 });
  const [modal, setModal] = useState('');
  const [form, setForm] = useState({ name: '', phone: '', item: '', customerId: '', quantity: '1', price: '', payment: 'cash', amount: '', description: '' });

  const refresh = async () => {
    try {
      const db = await database;
      const [cs, ss, ds, totals] = await Promise.all([
        db.getAllAsync('SELECT * FROM customers ORDER BY id DESC'),
        db.getAllAsync('SELECT s.*,c.name customer FROM sales s LEFT JOIN customers c ON c.id=s.customer_id ORDER BY s.id DESC'),
        db.getAllAsync('SELECT d.*,c.name customer,d.amount-COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.debt_id=d.id),0) remaining FROM debts d LEFT JOIN customers c ON c.id=d.customer_id ORDER BY d.id DESC'),
        db.getFirstAsync(`SELECT COALESCE((SELECT SUM(total) FROM sales),0) allSales,COALESCE((SELECT SUM(total) FROM sales WHERE sale_date=?),0) todaySales,COALESCE((SELECT SUM(amount-COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.debt_id=d.id),0)) FROM debts d),0) remaining`, today())
      ]);
      setCustomers(cs);
      setSales(ss);
      setDebts(ds);
      setSummary(totals || { allSales: 0, todaySales: 0, remaining: 0 });
    } catch (e) {
      Alert.alert('خطأ في تحميل البيانات', e.message);
    }
  };

  useEffect(() => {
    init().then(refresh).catch(e => Alert.alert('تعذّر فتح قاعدة البيانات', e.message));
  }, []);

  const set = (key, value) => setForm(v => ({ ...v, [key]: value }));
  const [modalDebt, setModalDebt] = useState(null);

  const open = (type) => {
    if (type !== 'customer' && !customers.length) {
      Alert.alert('أضف عميلًا أولًا', 'سجّل اسم العميل قبل إضافة بيع أو دين.');
      setTab('customers');
      return;
    }
    setForm({
      name: '',
      phone: '',
      item: '',
      customerId: customers[0] ? String(customers[0].id) : '',
      quantity: '1',
      price: '',
      payment: 'cash',
      amount: '',
      description: ''
    });
    setModal(type);
  };

  const save = async () => {
    const db = await database;
    try {
      if (modal === 'customer') {
        if (!form.name.trim()) return Alert.alert('تنبيه', 'اكتب اسم العميل.');
        await db.runAsync('INSERT INTO customers(name,phone,created_at) VALUES(?,?,?)', form.name.trim(), form.phone.trim(), today());
      } else if (modal === 'sale') {
        const q = Number(form.quantity);
        const p = Number(form.price);
        if (!form.item.trim() || !form.customerId || q <= 0 || p < 0 || !Number.isFinite(p)) {
          return Alert.alert('تحقق من البيانات', 'اختر العميل واكتب المنتج والكمية والسعر.');
        }
        const total = q * p;
        await db.runAsync('INSERT INTO sales(customer_id,item,quantity,unit_price,total,payment,sale_date) VALUES(?,?,?,?,?,?,?)', Number(form.customerId), form.item.trim(), q, p, total, form.payment, today());
        if (form.payment === 'credit') {
          await db.runAsync('INSERT INTO debts(customer_id,description,amount,created_at) VALUES(?,?,?,?)', Number(form.customerId), `بيع: ${form.item.trim()}`, total, today());
        }
      } else if (modal === 'debt') {
        const amount = Number(form.amount);
        if (!form.customerId || !form.description.trim() || amount <= 0 || !Number.isFinite(amount)) {
          return Alert.alert('تحقق من البيانات', 'اختر العميل واكتب الوصف والمبلغ.');
        }
        await db.runAsync('INSERT INTO debts(customer_id,description,amount,created_at) VALUES(?,?,?,?)', Number(form.customerId), form.description.trim(), amount, today());
      } else if (modal === 'payment') {
        const amount = Number(form.amount);
        const debt = modalDebt;
        if (amount <= 0 || amount > Number(debt.remaining)) {
          return Alert.alert('مبلغ غير صحيح', 'أدخل مبلغًا لا يتجاوز المتبقي.');
        }
        await db.runAsync('INSERT INTO payments(debt_id,amount,payment_date) VALUES(?,?,?)', debt.id, amount, today());
      }

      setModal('');
      await refresh();
    } catch (e) {
      Alert.alert('تعذّر الحفظ', e.message);
    }
  };

  const pay = (debt) => {
    setModalDebt(debt);
    setForm(v => ({ ...v, amount: String(debt.remaining) }));
    setModal('payment');
  };

  const tabs = [
    { id: 'home', title: 'الرئيسية', icon: '⌂' },
    { id: 'sales', title: 'المبيعات', icon: '▤' },
    { id: 'debts', title: 'الديون', icon: '◷' },
    { id: 'customers', title: 'العملاء', icon: '♙' }
  ];

  return (
    <SafeAreaView style={s.safe}>
      <ExpoStatusBar style="dark" />
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} />

      <View style={s.header}>
        <View>
          <Text style={s.eyebrow}>دفتر متجرك</Text>
          <Text style={s.title}>البيع والديون</Text>
        </View>
        <Pressable onPress={refresh} style={s.refresh}><Text style={{ color: C.blue, fontSize: 24 }}>↻</Text></Pressable>
      </View>

      {tab === 'home' && (
        <ScrollView contentContainerStyle={s.content}>
          <Text style={s.section}>ملخص نشاطك</Text>
          <Text style={s.muted}>البيانات محفوظة على هذا الجهاز.</Text>

          <View style={s.stats}>
            <Stat label="مبيعات اليوم" value={summary.todaySales} />
            <Stat label="إجمالي المبيعات" value={summary.allSales} />
            <Stat label="الديون المتبقية" value={summary.remaining} />
            <Stat label="العملاء" value={customers.length} />
          </View>

          <View style={s.sectionRow}>
            <Text style={s.section}>إجراءات سريعة</Text>
          </View>

          <View style={{ flexDirection: 'row', gap: 9 }}>
            <Button title="＋ بيع جديد" onPress={() => open('sale')} />
            <Button title="＋ تسجيل دين" secondary onPress={() => open('debt')} />
          </View>

          <Text style={[s.section, { marginTop: 22 }]}>آخر المبيعات</Text>
          {sales.slice(0, 4).map(x => <Sale key={x.id} item={x} />)}
          {!sales.length && <Empty text="لا توجد مبيعات بعد." />}
        </ScrollView>
      )}

      {tab === 'sales' && (
        <View style={s.page}>
          <View style={s.sectionRow}>
            <Text style={s.section}>سجل المبيعات</Text>
            <Pressable onPress={() => open('sale')}><Text style={{ color: C.blue, fontWeight: '700' }}>＋ إضافة</Text></Pressable>
          </View>
          <FlatList
            data={sales}
            keyExtractor={x => String(x.id)}
            ListEmptyComponent={<Empty text="لا توجد مبيعات مسجلة." />}
            renderItem={({ item }) => <Sale item={item} />}
          />
        </View>
      )}

      {tab === 'debts' && (
        <View style={s.page}>
          <View style={s.sectionRow}>
            <Text style={s.section}>سجل الديون</Text>
            <Pressable onPress={() => open('debt')}><Text style={{ color: C.blue, fontWeight: '700' }}>＋ إضافة</Text></Pressable>
          </View>
          <FlatList
            data={debts}
            keyExtractor={x => String(x.id)}
            ListEmptyComponent={<Empty text="لا توجد ديون مسجلة." />}
            renderItem={({ item }) => (
              <View style={s.card}>
                <View style={{ flex: 1 }}>
                  <Text style={s.cardTitle}>{item.customer || 'عميل'}</Text>
                  <Text style={s.muted}>{item.description} · {item.created_at}</Text>
                  <Text style={{ color: Number(item.remaining) ? C.red : C.green, textAlign: 'right', marginTop: 5 }}>
                    {Number(item.remaining) ? `المتبقي: ${money(item.remaining)}` : 'مسدد بالكامل'}
                  </Text>
                </View>
                {Number(item.remaining) > 0 && <Button title="تسديد" onPress={() => pay(item)} />}
              </View>
            )}
          />
        </View>
      )}

      {tab === 'customers' && (
        <View style={s.page}>
          <View style={s.sectionRow}>
            <Text style={s.section}>العملاء</Text>
            <Pressable onPress={() => open('customer')}><Text style={{ color: C.blue, fontWeight: '700' }}>＋ إضافة</Text></Pressable>
          </View>
          <FlatList
            data={customers}
            keyExtractor={x => String(x.id)}
            ListEmptyComponent={<Empty text="أضف أول عميل للبدء." />}
            renderItem={({ item }) => (
              <View style={s.card}>
                <Text style={{ fontSize: 22, color: C.blue }}>♙</Text>
                <View style={{ flex: 1 }}>
                  <Text style={s.cardTitle}>{item.name}</Text>
                  <Text style={s.muted}>{item.phone || 'بدون رقم هاتف'}</Text>
                </View>
              </View>
            )}
          />
        </View>
      )}

      <View style={s.nav}>
        {tabs.map(x => (
          <Pressable key={x.id} onPress={() => setTab(x.id)} style={s.navItem}>
            <Text style={[s.navIcon, tab === x.id && { color: C.blue }]}>{x.icon}</Text>
            <Text style={[s.navText, tab === x.id && { color: C.blue }]}>{x.title}</Text>
          </Pressable>
        ))}
      </View>

      <Modal visible={!!modal} transparent animationType="slide" onRequestClose={() => setModal('')}>
        <View style={s.backdrop}>
          <View style={s.modal}>
            <View style={s.modalHead}>
              <Pressable onPress={() => setModal('')}><Text style={{ fontSize: 28, color: C.muted }}>×</Text></Pressable>
              <Text style={s.modalTitle}>
                {{
                  customer: 'إضافة عميل',
                  sale: 'تسجيل بيع',
                  debt: 'تسجيل دين',
                  payment: 'تسجيل تسديد'
                }[modal]}
              </Text>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled">
              {modal === 'customer' && (
                <>
                  <Field label="اسم العميل" value={form.name} onChangeText={v => set('name', v)} />
                  <Field label="رقم الهاتف (اختياري)" value={form.phone} onChangeText={v => set('phone', v)} keyboardType="phone-pad" />
                </>
              )}

              {modal === 'sale' && (
                <>
                  <Picker customers={customers} value={form.customerId} onChange={v => set('customerId', v)} />
                  <Field label="اسم المنتج" value={form.item} onChangeText={v => set('item', v)} />
                  <Field label="الكمية" value={form.quantity} onChangeText={v => set('quantity', v)} keyboardType="decimal-pad" />
                  <Field label="سعر الوحدة" value={form.price} onChangeText={v => set('price', v)} keyboardType="decimal-pad" />
                  <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10, justifyContent: 'flex-end' }}>
                    <Choice title="نقدي" active={form.payment === 'cash'} onPress={() => set('payment', 'cash')} />
                    <Choice title="آجل" active={form.payment === 'credit'} onPress={() => set('payment', 'credit')} />
                  </View>
                </>
              )}

              {modal === 'debt' && (
                <>
                  <Picker customers={customers} value={form.customerId} onChange={v => set('customerId', v)} />
                  <Field label="وصف الدين" value={form.description} onChangeText={v => set('description', v)} />
                  <Field label="المبلغ" value={form.amount} onChangeText={v => set('amount', v)} keyboardType="decimal-pad" />
                </>
              )}

              {modal === 'payment' && (
                <>
                  <Text style={s.muted}>المتبقي: {money(modalDebt?.remaining)}</Text>
                  <Field label="مبلغ التسديد" value={form.amount} onChangeText={v => set('amount', v)} keyboardType="decimal-pad" />
                </>
              )}

              <Button title={modal === 'payment' ? 'تسجيل التسديد' : 'حفظ'} onPress={save} />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function Stat({ label, value }) {
  return (
    <View style={s.stat}>
      <Text style={s.muted}>{label}</Text>
      <Text style={s.statValue}>{money(value)}</Text>
    </View>
  );
}

function Sale({ item }) {
  return (
    <View style={s.card}>
      <View style={{ flex: 1 }}>
        <Text style={s.cardTitle}>{item.item} · {item.customer || 'عميل'}</Text>
        <Text style={s.muted}>{item.sale_date} · {item.quantity} × {money(item.unit_price)} · {item.payment === 'credit' ? 'آجل' : 'نقدي'}</Text>
      </View>
      <Text style={s.cardTitle}>{money(item.total)}</Text>
    </View>
  );
}

function Empty({ text }) {
  return <Text style={[s.muted, { textAlign: 'center', padding: 28 }]}>{text}</Text>;
}

function Picker({ customers, value, onChange }) {
  return (
    <View style={s.field}>
      <Text style={s.label}>العميل</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 7, justifyContent: 'flex-end' }}>
        {customers.map(c => (
          <Pressable key={c.id} onPress={() => onChange(String(c.id))} style={[s.choice, String(c.id) === value && s.choiceSelected]}>
            <Text style={{ color: String(c.id) === value ? C.blue : C.muted }}>{c.name}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function Choice({ title, active, onPress }) {
  return (
    <Pressable onPress={onPress} style={[s.choice, active && s.choiceSelected]}>
      <Text style={{ color: active ? C.blue : C.muted }}>{title}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg, paddingTop: Platform.OS === 'android' ? 8 : 0 },
  header: { padding: 18, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  eyebrow: { textAlign: 'right', color: C.blue, fontWeight: '700' },
  title: { textAlign: 'right', color: C.ink, fontSize: 25, fontWeight: '800', marginTop: 3 },
  refresh: { width: 44, height: 44, borderRadius: 14, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: 18, paddingBottom: 24 },
  section: { color: C.ink, textAlign: 'right', fontSize: 17, fontWeight: '800' },
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, marginTop: 10 },
  muted: { color: C.muted, textAlign: 'right', fontSize: 12, marginTop: 4 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginTop: 16 },
  stat: { width: '48%', backgroundColor: C.card, padding: 15, borderRadius: 15, marginBottom: 10 },
  statValue: { textAlign: 'right', fontSize: 21, fontWeight: '800', color: C.ink, marginTop: 6 },
  button: { backgroundColor: C.blue, borderRadius: 11, paddingHorizontal: 15, minHeight: 42, justifyContent: 'center', alignItems: 'center', marginTop: 8, flex: 1 },
  secondary: { backgroundColor: '#e9edff' },
  buttonText: { color: '#fff', fontWeight: '800' },
  page: { flex: 1, paddingHorizontal: 18 },
  card: { backgroundColor: C.card, borderRadius: 14, padding: 14, marginBottom: 9, flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardTitle: { color: C.ink, textAlign: 'right', fontSize: 14, fontWeight: '700' },
  nav: { flexDirection: 'row', backgroundColor: C.card, borderTopColor: C.border, borderTopWidth: 1, paddingVertical: 8 },
  navItem: { flex: 1, alignItems: 'center' },
  navIcon: { color: C.muted, fontSize: 20 },
  navText: { color: C.muted, fontSize: 10 },
  field: { marginBottom: 12 },
  label: { color: C.ink, textAlign: 'right', fontWeight: '700', marginBottom: 6 },
  input: { backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 11, minHeight: 46, paddingHorizontal: 12, color: C.ink },
  choice: { borderWidth: 1, borderColor: C.border, backgroundColor: C.card, borderRadius: 10, padding: 11, marginVertical: 3 },
  choiceSelected: { borderColor: C.blue, backgroundColor: '#e9edff' },
  backdrop: { flex: 1, backgroundColor: '#0006', justifyContent: 'flex-end' },
  modal: { maxHeight: '90%', backgroundColor: C.bg, padding: 20, borderTopLeftRadius: 22, borderTopRightRadius: 22 },
  modalHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  modalTitle: { color: C.ink, fontSize: 20, fontWeight: '800' }
});
